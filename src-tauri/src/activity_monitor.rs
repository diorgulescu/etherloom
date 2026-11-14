use crate::fabric::{LinkSnapshot, PacketFabric};
use crate::vm_manager::{GuestArch, VmInstanceInfo, VmManager, VmStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tokio::time::sleep;

/// Maximum age of a cached baseline sample before taking a fresh 120ms micro-window
/// so opening Activity Monitor after being closed for minutes immediately reports live rates.
const MAX_BASELINE_AGE: Duration = Duration::from_secs(6);
const INITIAL_MICRO_SAMPLE_WINDOW: Duration = Duration::from_millis(120);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostResourceSummary {
    pub timestamp_ms: u64,
    pub sample_interval_ms: u64,
    pub host_arch: String,
    pub host_logical_cpus: u32,
    pub host_total_memory_bytes: u64,
    pub studio_pid: u32,
    pub studio_cpu_percent: f64,
    pub studio_memory_bytes: u64,
    pub active_vm_count: usize,
    pub total_vm_cpu_percent: f64,
    pub total_vm_memory_bytes: u64,
    pub total_fabric_bytes_per_sec: f64,
    pub total_fabric_packets_per_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmProcessTelemetry {
    pub node_id: String,
    pub name: String,
    pub status: VmStatus,
    pub pid: Option<u32>,
    pub arch: GuestArch,
    pub accel: String,
    pub allocated_cpus: u8,
    pub allocated_ram_mb: u32,
    pub uptime_ms: u64,
    /// macOS Activity Monitor style CPU % (`100.0` = 1 logical core fully utilized; max `allocated_cpus * 100.0`).
    pub cpu_percent: f64,
    /// Normalized guest CPU saturation (`0.0 ..= 100.0` relative to `allocated_cpus`).
    pub cpu_normalized_percent: f64,
    /// Physical memory footprint (`ri_phys_footprint`, matching macOS Activity Monitor's "Memory" column).
    pub memory_bytes: u64,
    /// Resident Set Size (`ri_resident_size` / RSS).
    pub resident_bytes: u64,
    pub thread_count: u32,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub overlay_disk_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortTrafficTelemetry {
    pub port_id: String,
    pub link_id: String,
    pub admin_up: bool,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub tx_packets: u64,
    pub rx_packets: u64,
    pub dropped_packets: u64,
    pub tx_bytes_per_sec: f64,
    pub rx_bytes_per_sec: f64,
    pub tx_packets_per_sec: f64,
    pub rx_packets_per_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityMonitorSnapshot {
    pub host: HostResourceSummary,
    pub vms: Vec<VmProcessTelemetry>,
    pub port_traffic: HashMap<String, PortTrafficTelemetry>,
}

#[derive(Debug, Clone, Copy, Default)]
struct RawPidSample {
    cpu_time_ns: u64,
    memory_bytes: u64,
    resident_bytes: u64,
    thread_count: u32,
    disk_read_bytes: u64,
    disk_write_bytes: u64,
}

#[derive(Debug, Clone, Copy, Default)]
struct RawPortCounters {
    tx_bytes: u64,
    rx_bytes: u64,
    tx_packets: u64,
    rx_packets: u64,
}

#[derive(Debug, Clone, Copy, Default)]
struct RawLinkTotals {
    total_bytes: u64,
    total_packets: u64,
}

struct PrevTelemetryBaseline {
    sampled_at: Instant,
    pid_cpu_ns: HashMap<u32, u64>,
    port_counters: HashMap<String, RawPortCounters>,
    link_totals: HashMap<String, RawLinkTotals>,
}

/// Stateful zero-root host & per-node resource sampler combining macOS `proc_pid_rusage` / `proc_pidinfo`
/// with `PacketFabric` directional per-port frame counters.
pub struct ActivityMonitor {
    baseline: Mutex<Option<PrevTelemetryBaseline>>,
}

impl Default for ActivityMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl ActivityMonitor {
    pub fn new() -> Self {
        Self {
            baseline: Mutex::new(None),
        }
    }

    pub async fn sample(
        &self,
        vm_manager: &VmManager,
        fabric: &PacketFabric,
    ) -> ActivityMonitorSnapshot {
        let mut guard = self.baseline.lock().await;

        let needs_micro_prime = match *guard {
            None => true,
            Some(ref prev) => prev.sampled_at.elapsed() > MAX_BASELINE_AGE,
        };

        if needs_micro_prime {
            let vms_prime = vm_manager.list_vms().await;
            let links_prime = fabric.list_links().await;
            *guard = Some(capture_baseline(&vms_prime, &links_prime));
            sleep(INITIAL_MICRO_SAMPLE_WINDOW).await;
        }

        let now_inst = Instant::now();
        let now_ms = now_epoch_ms();
        let vms_raw = vm_manager.list_vms().await;
        let links = fabric.list_links().await;

        let prev = guard
            .take()
            .unwrap_or_else(|| capture_baseline(&vms_raw, &links));
        let dt_secs = now_inst
            .saturating_duration_since(prev.sampled_at)
            .as_secs_f64()
            .max(0.020);

        let mut next_pid_cpu_ns: HashMap<u32, u64> = HashMap::with_capacity(vms_raw.len() + 1);
        let studio_pid = std::process::id();
        let studio_raw = query_process_metrics(studio_pid).unwrap_or_default();
        next_pid_cpu_ns.insert(studio_pid, studio_raw.cpu_time_ns);
        let studio_cpu_percent = compute_cpu_percent(
            prev.pid_cpu_ns.get(&studio_pid).copied(),
            studio_raw.cpu_time_ns,
            dt_secs,
        );

        let mut vm_rows: Vec<VmProcessTelemetry> = Vec::with_capacity(vms_raw.len());
        let mut active_vm_count = 0usize;
        let mut total_vm_cpu_percent = 0.0f64;
        let mut total_vm_memory_bytes = 0u64;

        for vm in &vms_raw {
            let is_running = matches!(vm.status, VmStatus::Starting | VmStatus::Running);
            let overlay_disk_bytes = fs::metadata(&vm.disk_path)
                .map(|m| m.len())
                .unwrap_or(0);

            if is_running {
                active_vm_count += 1;
            }

            let (
                cpu_percent,
                cpu_normalized_percent,
                memory_bytes,
                resident_bytes,
                thread_count,
                disk_read_bytes,
                disk_write_bytes,
            ) = if let (true, Some(pid)) = (is_running, vm.pid) {
                if let Some(sample) = query_process_metrics(pid) {
                    next_pid_cpu_ns.insert(pid, sample.cpu_time_ns);
                    let raw_pct = compute_cpu_percent(
                        prev.pid_cpu_ns.get(&pid).copied(),
                        sample.cpu_time_ns,
                        dt_secs,
                    );
                    let max_pct = (vm.cpus.max(1) as f64) * 100.0;
                    let clamped_pct = raw_pct.clamp(0.0, max_pct);
                    let norm_pct = (clamped_pct / (vm.cpus.max(1) as f64)).clamp(0.0, 100.0);
                    total_vm_cpu_percent += clamped_pct;
                    total_vm_memory_bytes =
                        total_vm_memory_bytes.saturating_add(sample.memory_bytes);
                    (
                        round_tenth(clamped_pct),
                        round_tenth(norm_pct),
                        sample.memory_bytes,
                        sample.resident_bytes,
                        sample.thread_count,
                        sample.disk_read_bytes,
                        sample.disk_write_bytes,
                    )
                } else {
                    (0.0, 0.0, 0, 0, 0, 0, 0)
                }
            } else {
                (0.0, 0.0, 0, 0, 0, 0, 0)
            };

            let uptime_ms = if is_running && vm.started_at_ms > 0 {
                now_ms.saturating_sub(vm.started_at_ms)
            } else {
                0
            };

            vm_rows.push(VmProcessTelemetry {
                node_id: vm.node_id.clone(),
                name: vm.name.clone(),
                status: vm.status,
                pid: if is_running { vm.pid } else { None },
                arch: vm.arch,
                accel: vm.accel.clone(),
                allocated_cpus: vm.cpus.max(1),
                allocated_ram_mb: vm.ram_mb,
                uptime_ms,
                cpu_percent,
                cpu_normalized_percent,
                memory_bytes,
                resident_bytes,
                thread_count,
                disk_read_bytes,
                disk_write_bytes,
                overlay_disk_bytes,
            });
        }

        // Compute directional per-port counters & instantaneous throughput rates across all wires
        let mut next_port_counters: HashMap<String, RawPortCounters> =
            HashMap::with_capacity(links.len() * 2);
        let mut next_link_totals: HashMap<String, RawLinkTotals> =
            HashMap::with_capacity(links.len());
        let mut port_traffic: HashMap<String, PortTrafficTelemetry> =
            HashMap::with_capacity(links.len() * 2);

        let mut total_fabric_bytes_per_sec = 0.0f64;
        let mut total_fabric_packets_per_sec = 0.0f64;

        for link in &links {
            let link_tot = RawLinkTotals {
                total_bytes: link.tx_bytes.saturating_add(link.rx_bytes),
                total_packets: link.tx_packets.saturating_add(link.rx_packets),
            };
            if let Some(prev_lt) = prev.link_totals.get(&link.id) {
                total_fabric_bytes_per_sec +=
                    (link_tot.total_bytes.saturating_sub(prev_lt.total_bytes) as f64) / dt_secs;
                total_fabric_packets_per_sec +=
                    (link_tot.total_packets.saturating_sub(prev_lt.total_packets) as f64) / dt_secs;
            }
            next_link_totals.insert(link.id.clone(), link_tot);

            // On WireLink: `tx_*` is `port_a -> port_b`; `rx_*` is `port_b -> port_a`
            accumulate_port_endpoint(
                &mut port_traffic,
                &mut next_port_counters,
                &prev.port_counters,
                &link.port_a,
                &link.id,
                link.admin_up,
                link.tx_bytes,
                link.rx_bytes,
                link.tx_packets,
                link.rx_packets,
                link.dropped_packets,
                dt_secs,
            );
            accumulate_port_endpoint(
                &mut port_traffic,
                &mut next_port_counters,
                &prev.port_counters,
                &link.port_b,
                &link.id,
                link.admin_up,
                link.rx_bytes,
                link.tx_bytes,
                link.rx_packets,
                link.tx_packets,
                link.dropped_packets,
                dt_secs,
            );
        }

        *guard = Some(PrevTelemetryBaseline {
            sampled_at: now_inst,
            pid_cpu_ns: next_pid_cpu_ns,
            port_counters: next_port_counters,
            link_totals: next_link_totals,
        });

        let host_logical_cpus = std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(1);

        ActivityMonitorSnapshot {
            host: HostResourceSummary {
                timestamp_ms: now_ms,
                sample_interval_ms: (dt_secs * 1000.0).round() as u64,
                host_arch: std::env::consts::ARCH.to_string(),
                host_logical_cpus,
                host_total_memory_bytes: query_host_total_memory_bytes(),
                studio_pid,
                studio_cpu_percent: round_tenth(studio_cpu_percent),
                studio_memory_bytes: studio_raw.memory_bytes,
                active_vm_count,
                total_vm_cpu_percent: round_tenth(total_vm_cpu_percent),
                total_vm_memory_bytes,
                total_fabric_bytes_per_sec: round_tenth(total_fabric_bytes_per_sec),
                total_fabric_packets_per_sec: round_tenth(total_fabric_packets_per_sec),
            },
            vms: vm_rows,
            port_traffic,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn accumulate_port_endpoint(
    port_traffic: &mut HashMap<String, PortTrafficTelemetry>,
    next_port_counters: &mut HashMap<String, RawPortCounters>,
    prev_port_counters: &HashMap<String, RawPortCounters>,
    port_id: &str,
    link_id: &str,
    admin_up: bool,
    endpoint_tx_bytes: u64,
    endpoint_rx_bytes: u64,
    endpoint_tx_packets: u64,
    endpoint_rx_packets: u64,
    dropped_packets: u64,
    dt_secs: f64,
) {
    let entry_raw = next_port_counters
        .entry(port_id.to_string())
        .or_default();
    entry_raw.tx_bytes = entry_raw.tx_bytes.saturating_add(endpoint_tx_bytes);
    entry_raw.rx_bytes = entry_raw.rx_bytes.saturating_add(endpoint_rx_bytes);
    entry_raw.tx_packets = entry_raw.tx_packets.saturating_add(endpoint_tx_packets);
    entry_raw.rx_packets = entry_raw.rx_packets.saturating_add(endpoint_rx_packets);

    let (tx_bps, rx_bps, tx_pps, rx_pps) = if let Some(prev) = prev_port_counters.get(port_id) {
        (
            round_tenth((entry_raw.tx_bytes.saturating_sub(prev.tx_bytes) as f64) / dt_secs),
            round_tenth((entry_raw.rx_bytes.saturating_sub(prev.rx_bytes) as f64) / dt_secs),
            round_tenth((entry_raw.tx_packets.saturating_sub(prev.tx_packets) as f64) / dt_secs),
            round_tenth((entry_raw.rx_packets.saturating_sub(prev.rx_packets) as f64) / dt_secs),
        )
    } else {
        (0.0, 0.0, 0.0, 0.0)
    };

    port_traffic.insert(
        port_id.to_string(),
        PortTrafficTelemetry {
            port_id: port_id.to_string(),
            link_id: link_id.to_string(),
            admin_up,
            tx_bytes: entry_raw.tx_bytes,
            rx_bytes: entry_raw.rx_bytes,
            tx_packets: entry_raw.tx_packets,
            rx_packets: entry_raw.rx_packets,
            dropped_packets,
            tx_bytes_per_sec: tx_bps,
            rx_bytes_per_sec: rx_bps,
            tx_packets_per_sec: tx_pps,
            rx_packets_per_sec: rx_pps,
        },
    );
}

fn capture_baseline(vms: &[VmInstanceInfo], links: &[LinkSnapshot]) -> PrevTelemetryBaseline {
    let sampled_at = Instant::now();
    let mut pid_cpu_ns = HashMap::with_capacity(vms.len() + 1);
    let studio_pid = std::process::id();
    if let Some(s) = query_process_metrics(studio_pid) {
        pid_cpu_ns.insert(studio_pid, s.cpu_time_ns);
    }
    for vm in vms {
        if matches!(vm.status, VmStatus::Starting | VmStatus::Running) {
            if let Some(pid) = vm.pid {
                if let Some(s) = query_process_metrics(pid) {
                    pid_cpu_ns.insert(pid, s.cpu_time_ns);
                }
            }
        }
    }

    let mut port_counters: HashMap<String, RawPortCounters> = HashMap::with_capacity(links.len() * 2);
    let mut link_totals: HashMap<String, RawLinkTotals> = HashMap::with_capacity(links.len());
    for link in links {
        link_totals.insert(
            link.id.clone(),
            RawLinkTotals {
                total_bytes: link.tx_bytes.saturating_add(link.rx_bytes),
                total_packets: link.tx_packets.saturating_add(link.rx_packets),
            },
        );
        let pa = port_counters.entry(link.port_a.clone()).or_default();
        pa.tx_bytes = pa.tx_bytes.saturating_add(link.tx_bytes);
        pa.rx_bytes = pa.rx_bytes.saturating_add(link.rx_bytes);
        pa.tx_packets = pa.tx_packets.saturating_add(link.tx_packets);
        pa.rx_packets = pa.rx_packets.saturating_add(link.rx_packets);

        let pb = port_counters.entry(link.port_b.clone()).or_default();
        pb.tx_bytes = pb.tx_bytes.saturating_add(link.rx_bytes);
        pb.rx_bytes = pb.rx_bytes.saturating_add(link.tx_bytes);
        pb.tx_packets = pb.tx_packets.saturating_add(link.rx_packets);
        pb.rx_packets = pb.rx_packets.saturating_add(link.tx_packets);
    }

    PrevTelemetryBaseline {
        sampled_at,
        pid_cpu_ns,
        port_counters,
        link_totals,
    }
}

fn compute_cpu_percent(prev_ns: Option<u64>, curr_ns: u64, dt_secs: f64) -> f64 {
    let Some(prev) = prev_ns else {
        return 0.0;
    };
    if dt_secs <= 0.0 || curr_ns <= prev {
        return 0.0;
    }
    let delta_secs = (curr_ns - prev) as f64 / 1_000_000_000.0;
    (delta_secs / dt_secs) * 100.0
}

fn round_tenth(v: f64) -> f64 {
    if !v.is_finite() || v <= 0.0 {
        0.0
    } else {
        (v * 10.0).round() / 10.0
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn mach_ticks_to_nanos(ticks: u64) -> u64 {
    #[repr(C)]
    struct MachTimebaseInfo {
        numer: u32,
        denom: u32,
    }
    extern "C" {
        fn mach_timebase_info(info: *mut MachTimebaseInfo) -> libc::c_int;
    }

    static TIMEBASE: OnceLock<(u32, u32)> = OnceLock::new();
    let (numer, denom) = *TIMEBASE.get_or_init(|| {
        let mut info = MachTimebaseInfo { numer: 1, denom: 1 };
        let rc = unsafe { mach_timebase_info(&mut info) };
        if rc == 0 && info.denom > 0 {
            (info.numer, info.denom)
        } else {
            (1, 1)
        }
    });

    ((ticks as u128 * numer as u128) / denom as u128) as u64
}

#[cfg(target_os = "macos")]
fn query_process_metrics(pid: u32) -> Option<RawPidSample> {
    let mut task_info: libc::proc_taskinfo = unsafe { std::mem::zeroed() };
    let expected_ti_size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
    let ti_bytes = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDTASKINFO,
            0,
            (&mut task_info as *mut libc::proc_taskinfo).cast::<libc::c_void>(),
            expected_ti_size,
        )
    };
    let has_task_info = ti_bytes == expected_ti_size;

    let mut rusage: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
    let ru_rc = unsafe {
        libc::proc_pid_rusage(
            pid as libc::c_int,
            libc::RUSAGE_INFO_V2,
            (&mut rusage as *mut libc::rusage_info_v2).cast::<libc::rusage_info_t>(),
        )
    };
    let has_rusage = ru_rc == 0;

    if !has_rusage && !has_task_info {
        return None;
    }

    let raw_ticks = if has_rusage {
        rusage.ri_user_time.saturating_add(rusage.ri_system_time)
    } else {
        task_info
            .pti_total_user
            .saturating_add(task_info.pti_total_system)
    };

    let resident_bytes = if has_rusage && rusage.ri_resident_size > 0 {
        rusage.ri_resident_size
    } else if has_task_info {
        task_info.pti_resident_size
    } else {
        0
    };

    let memory_bytes = if has_rusage && rusage.ri_phys_footprint > 0 {
        rusage.ri_phys_footprint
    } else {
        resident_bytes
    };

    let thread_count = if has_task_info && task_info.pti_threadnum > 0 {
        task_info.pti_threadnum as u32
    } else {
        1
    };

    Some(RawPidSample {
        cpu_time_ns: mach_ticks_to_nanos(raw_ticks),
        memory_bytes,
        resident_bytes,
        thread_count,
        disk_read_bytes: if has_rusage {
            rusage.ri_diskio_bytesread
        } else {
            0
        },
        disk_write_bytes: if has_rusage {
            rusage.ri_diskio_byteswritten
        } else {
            0
        },
    })
}

#[cfg(not(target_os = "macos"))]
fn query_process_metrics(_pid: u32) -> Option<RawPidSample> {
    None
}

#[cfg(target_os = "macos")]
fn query_host_total_memory_bytes() -> u64 {
    static TOTAL_MEM: OnceLock<u64> = OnceLock::new();
    *TOTAL_MEM.get_or_init(|| {
        let mut memsize: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        let name = b"hw.memsize\0";
        let rc = unsafe {
            libc::sysctlbyname(
                name.as_ptr().cast::<libc::c_char>(),
                (&mut memsize as *mut u64).cast::<libc::c_void>(),
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        if rc == 0 {
            memsize
        } else {
            0
        }
    })
}

#[cfg(not(target_os = "macos"))]
fn query_host_total_memory_bytes() -> u64 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_current_macos_process_memory_threads_and_host_ram() {
        let total_ram = query_host_total_memory_bytes();
        assert!(total_ram >= 1024 * 1024 * 1024, "Expected >= 1 GiB host RAM");

        let self_pid = std::process::id();
        let s1 = query_process_metrics(self_pid).expect("Current PID must be inspectable");
        assert!(s1.memory_bytes > 0);
        assert!(s1.resident_bytes > 0);
        assert!(s1.thread_count >= 1);

        // Burn a few milliseconds of CPU so Mach timebase delta is strictly positive
        let mut acc = 0u64;
        for i in 1..250_000u64 {
            acc = acc.wrapping_mul(6364136223846793005).wrapping_add(i);
        }
        std::hint::black_box(acc);

        let s2 = query_process_metrics(self_pid).expect("Second sample must succeed");
        assert!(s2.cpu_time_ns >= s1.cpu_time_ns);
    }

    #[tokio::test]
    async fn activity_monitor_computes_snapshot_with_studio_telemetry() {
        let monitor = ActivityMonitor::new();
        let vm_mgr = VmManager::new();
        let fabric = PacketFabric::new();
        let snap = monitor.sample(&vm_mgr, &fabric).await;

        assert_eq!(snap.host.studio_pid, std::process::id());
        assert!(snap.host.studio_memory_bytes > 0);
        assert!(snap.host.host_logical_cpus >= 1);
    }
}
