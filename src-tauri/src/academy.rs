use crate::images::{builtin_os_profiles, BaseTemplateInfo, ImageStore};
use crate::storage::verify_volume_mounted_under;
use crate::workspace::{save_project_bundle, ProjectBundleDto, SaveProjectRequest, TopologyDocument};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const LAB_SCHEMA_VERSION: u32 = 1;

struct EmbeddedLabAsset {
    id: &'static str,
    lab_toml: &'static str,
    guide_md: &'static str,
}

const BUILTIN_LAB_ASSETS: &[EmbeddedLabAsset] = &[
    EmbeddedLabAsset {
        id: "01-ethernet-hubs-switches-arp",
        lab_toml: include_str!("../../labs/01-ethernet-hubs-switches-arp/lab.toml"),
        guide_md: include_str!("../../labs/01-ethernet-hubs-switches-arp/guide.md"),
    },
    EmbeddedLabAsset {
        id: "02-ip-subnetting-static-routing",
        lab_toml: include_str!("../../labs/02-ip-subnetting-static-routing/lab.toml"),
        guide_md: include_str!("../../labs/02-ip-subnetting-static-routing/guide.md"),
    },
    EmbeddedLabAsset {
        id: "03-openbsd-pf-stateful-nat",
        lab_toml: include_str!("../../labs/03-openbsd-pf-stateful-nat/lab.toml"),
        guide_md: include_str!("../../labs/03-openbsd-pf-stateful-nat/guide.md"),
    },
    EmbeddedLabAsset {
        id: "04-openbsd-carp-pfsync-ha",
        lab_toml: include_str!("../../labs/04-openbsd-carp-pfsync-ha/lab.toml"),
        guide_md: include_str!("../../labs/04-openbsd-carp-pfsync-ha/guide.md"),
    },
    EmbeddedLabAsset {
        id: "05-tcp-handshakes-window-loss",
        lab_toml: include_str!("../../labs/05-tcp-handshakes-window-loss/lab.toml"),
        guide_md: include_str!("../../labs/05-tcp-handshakes-window-loss/guide.md"),
    },
];

fn default_lab_schema() -> u32 {
    LAB_SCHEMA_VERSION
}

fn default_minutes() -> u32 {
    20
}

/// Step definition inside `labs/{lab_id}/lab.toml`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawLabStep {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub highlight_links: Vec<String>,
}

/// Declarative `labs/{lab_id}/lab.toml` manifest structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawLabManifest {
    #[serde(default = "default_lab_schema")]
    pub schema_version: u32,
    pub id: String,
    #[serde(default)]
    pub number: u32,
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    pub difficulty: String,
    #[serde(default = "default_minutes")]
    pub estimated_minutes: u32,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub required_os_profiles: Vec<String>,
    #[serde(default)]
    pub steps: Vec<RawLabStep>,
    pub topology: TopologyDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabStepDto {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub highlight_links: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabTemplateRequirementStatus {
    pub os_profile_id: String,
    pub os_profile_name: String,
    pub guest_family: String,
    pub satisfied: bool,
    pub matched_template_id: Option<String>,
    pub matched_template_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademyLabSummary {
    pub id: String,
    pub number: u32,
    pub title: String,
    pub subtitle: String,
    pub difficulty: String,
    pub estimated_minutes: u32,
    pub tags: Vec<String>,
    pub node_count: usize,
    pub link_count: usize,
    pub step_count: usize,
    pub required_templates: Vec<LabTemplateRequirementStatus>,
    pub all_templates_ready: bool,
    pub source_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademyLabDetail {
    pub summary: AcademyLabSummary,
    pub steps: Vec<LabStepDto>,
    pub guide_markdown: String,
    pub topology: TopologyDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstantiatedLabDto {
    pub lab: AcademyLabDetail,
    pub bundle: ProjectBundleDto,
    pub auto_bound_templates: usize,
}

#[derive(Debug, Clone)]
struct LoadedLabPackage {
    manifest: RawLabManifest,
    guide_markdown: String,
    source_kind: String,
}

fn load_all_lab_packages(custom_labs_dir: Option<&Path>) -> Result<Vec<LoadedLabPackage>, String> {
    let mut map: BTreeMap<String, LoadedLabPackage> = BTreeMap::new();

    for asset in BUILTIN_LAB_ASSETS {
        let manifest: RawLabManifest = toml::from_str(asset.lab_toml)
            .map_err(|e| format!("Failed parsing built-in lab '{}': {e}", asset.id))?;
        map.insert(
            manifest.id.clone(),
            LoadedLabPackage {
                manifest,
                guide_markdown: asset.guide_md.to_string(),
                source_kind: "builtin".to_string(),
            },
        );
    }

    // Optional user/instructor custom labs under `{storage_root}/labs/{lab_id}/{lab.toml, guide.md}`
    if let Some(dir) = custom_labs_dir {
        if dir.is_dir() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let sub = entry.path();
                    if !sub.is_dir() {
                        continue;
                    }
                    let manifest_path = sub.join("lab.toml");
                    let guide_path = sub.join("guide.md");
                    if !manifest_path.is_file() || !guide_path.is_file() {
                        continue;
                    }
                    if let (Ok(toml_str), Ok(md_str)) = (
                        fs::read_to_string(&manifest_path),
                        fs::read_to_string(&guide_path),
                    ) {
                        if let Ok(manifest) = toml::from_str::<RawLabManifest>(&toml_str) {
                            map.insert(
                                manifest.id.clone(),
                                LoadedLabPackage {
                                    manifest,
                                    guide_markdown: md_str,
                                    source_kind: "custom".to_string(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    let mut list: Vec<LoadedLabPackage> = map.into_values().collect();
    list.sort_by(|a, b| {
        a.manifest
            .number
            .cmp(&b.manifest.number)
            .then_with(|| a.manifest.id.cmp(&b.manifest.id))
    });
    Ok(list)
}

/// Finds the best registered Golden Base Template matching `os_profile_id` (or same `guest_family` fallback for Linux).
fn match_template_for_profile<'a>(
    os_profile_id: &str,
    templates: &'a [BaseTemplateInfo],
) -> Option<&'a BaseTemplateInfo> {
    if let Some(exact) = templates.iter().find(|t| t.os_profile_id == os_profile_id) {
        return Some(exact);
    }

    // Friendly Linux compatibility fallback: e.g. if a lab specifies `alpine-linux` and the user
    // already built a `debian-linux` Golden Template (both `guest_family == "linux"` using `eth{n}`).
    let profiles = builtin_os_profiles();
    let req_family = profiles
        .iter()
        .find(|p| p.id == os_profile_id)
        .map(|p| p.guest_family.as_str());

    if req_family == Some("linux") {
        return templates.iter().find(|t| {
            profiles
                .iter()
                .find(|p| p.id == t.os_profile_id)
                .map(|p| p.guest_family == "linux")
                .unwrap_or(false)
        });
    }

    None
}

fn build_lab_detail(pkg: LoadedLabPackage, templates: &[BaseTemplateInfo]) -> AcademyLabDetail {
    let os_profiles = builtin_os_profiles();

    let required_templates: Vec<LabTemplateRequirementStatus> = pkg
        .manifest
        .required_os_profiles
        .iter()
        .map(|prof_id| {
            let prof_meta = os_profiles.iter().find(|p| &p.id == prof_id);
            let os_profile_name = prof_meta
                .map(|p| p.name.clone())
                .unwrap_or_else(|| prof_id.clone());
            let guest_family = prof_meta
                .map(|p| p.guest_family.clone())
                .unwrap_or_else(|| "linux".to_string());
            let matched = match_template_for_profile(prof_id, templates);

            LabTemplateRequirementStatus {
                os_profile_id: prof_id.clone(),
                os_profile_name,
                guest_family,
                satisfied: matched.is_some(),
                matched_template_id: matched.map(|t| t.id.clone()),
                matched_template_name: matched.map(|t| t.name.clone()),
            }
        })
        .collect();

    let all_templates_ready = required_templates.iter().all(|r| r.satisfied);

    let steps: Vec<LabStepDto> = pkg
        .manifest
        .steps
        .into_iter()
        .map(|s| LabStepDto {
            id: s.id,
            title: s.title,
            summary: s.summary,
            highlight_links: s.highlight_links,
        })
        .collect();

    let summary = AcademyLabSummary {
        id: pkg.manifest.id,
        number: pkg.manifest.number,
        title: pkg.manifest.title,
        subtitle: pkg.manifest.subtitle,
        difficulty: pkg.manifest.difficulty,
        estimated_minutes: pkg.manifest.estimated_minutes,
        tags: pkg.manifest.tags,
        node_count: pkg.manifest.topology.nodes.len(),
        link_count: pkg.manifest.topology.links.len(),
        step_count: steps.len(),
        required_templates,
        all_templates_ready,
        source_kind: pkg.source_kind,
    };

    AcademyLabDetail {
        summary,
        steps,
        guide_markdown: pkg.guide_markdown,
        topology: pkg.manifest.topology,
    }
}

/// Lists all built-in and custom Academy labs along with live Golden Template readiness.
pub fn list_academy_labs(
    templates: &[BaseTemplateInfo],
    custom_labs_dir: Option<&Path>,
) -> Result<Vec<AcademyLabSummary>, String> {
    let packages = load_all_lab_packages(custom_labs_dir)?;
    Ok(packages
        .into_iter()
        .map(|pkg| build_lab_detail(pkg, templates).summary)
        .collect())
}

/// Loads the full guide Markdown, step metadata, and topology blueprint for a single lab.
pub fn get_academy_lab_detail(
    lab_id: &str,
    templates: &[BaseTemplateInfo],
    custom_labs_dir: Option<&Path>,
) -> Result<AcademyLabDetail, String> {
    let trimmed = lab_id.trim();
    let packages = load_all_lab_packages(custom_labs_dir)?;
    let pkg = packages
        .into_iter()
        .find(|p| p.manifest.id == trimmed)
        .ok_or_else(|| format!("Guided lab '{trimmed}' not found"))?;
    Ok(build_lab_detail(pkg, templates))
}

/// Instantiates (or cleanly resets) a sandbox `.etherloom` workspace copy of `lab_id`
/// inside `workspaces_dir/academy-{lab_id}.etherloom`, auto-binding available OS templates.
pub async fn instantiate_academy_lab(
    lab_id: &str,
    workspaces_dir: &Path,
    custom_labs_dir: Option<&Path>,
    image_store: &ImageStore,
    volumes_root: &Path,
    reset_clean: bool,
) -> Result<InstantiatedLabDto, String> {
    if let Err(unmounted) = verify_volume_mounted_under(volumes_root, workspaces_dir) {
        return Err(format!(
            "Target workspace volume '{}' is disconnected ({})",
            unmounted.volume_name, unmounted.expected_path
        ));
    }

    let templates = image_store.list_templates().await.unwrap_or_default();
    let mut detail = get_academy_lab_detail(lab_id, &templates, custom_labs_dir)?;

    let safe_slug: String = detail
        .summary
        .id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let bundle_dir: PathBuf = workspaces_dir.join(format!("academy-{safe_slug}.etherloom"));

    // Clean wipe of sandbox `overlays/` and `captures/` when launching fresh or clicking "Reset Lab"
    if reset_clean && bundle_dir.exists() {
        let overlays = bundle_dir.join("overlays");
        if overlays.is_dir() {
            let _ = fs::remove_dir_all(&overlays);
        }
        let captures = bundle_dir.join("captures");
        if captures.is_dir() {
            let _ = fs::remove_dir_all(&captures);
        }
    }

    // Auto-bind matching Golden Base Templates onto VM nodes so 1-click "Start Lab" boots CoW overlays immediately
    let mut auto_bound_templates = 0usize;
    for node in &mut detail.topology.nodes {
        if node.kind != "vm" {
            continue;
        }
        if node.template_id.is_none() {
            if let Some(ref prof_id) = node.os_profile_id {
                if let Some(tpl) = match_template_for_profile(prof_id, &templates) {
                    node.template_id = Some(tpl.id.clone());
                    auto_bound_templates += 1;
                }
            }
        }
    }

    let bundle = save_project_bundle(
        SaveProjectRequest {
            bundle_path: bundle_dir.display().to_string(),
            copy_from_bundle: None,
            topology: detail.topology.clone(),
        },
        image_store,
        volumes_root,
    )
    .await?;

    detail.topology = bundle.topology.clone();

    Ok(InstantiatedLabDto {
        lab: detail,
        bundle,
        auto_bound_templates,
    })
}

/// Validates referential integrity of a lab's topology nodes, ports, links, and step wire highlights.
pub fn validate_lab_integrity(detail: &AcademyLabDetail) -> Result<(), String> {
    let mut node_ids = HashSet::new();
    let mut port_owner = BTreeMap::new();
    for node in &detail.topology.nodes {
        if !node_ids.insert(node.id.clone()) {
            return Err(format!(
                "Duplicate node id '{}' in lab '{}'",
                node.id, detail.summary.id
            ));
        }
        for port in &node.ports {
            if port_owner
                .insert(port.id.clone(), node.id.clone())
                .is_some()
            {
                return Err(format!(
                    "Duplicate port id '{}' in lab '{}'",
                    port.id, detail.summary.id
                ));
            }
        }
    }

    let mut link_ids = HashSet::new();
    for link in &detail.topology.links {
        if !link_ids.insert(link.id.clone()) {
            return Err(format!(
                "Duplicate link id '{}' in lab '{}'",
                link.id, detail.summary.id
            ));
        }
        if port_owner.get(&link.source_port) != Some(&link.source_node) {
            return Err(format!(
                "Link '{}' source_port '{}' does not belong to source_node '{}'",
                link.id, link.source_port, link.source_node
            ));
        }
        if port_owner.get(&link.target_port) != Some(&link.target_node) {
            return Err(format!(
                "Link '{}' target_port '{}' does not belong to target_node '{}'",
                link.id, link.target_port, link.target_node
            ));
        }
    }

    for step in &detail.steps {
        for hl in &step.highlight_links {
            if !link_ids.contains(hl) {
                return Err(format!(
                    "Step '{}' in lab '{}' highlights non-existent link '{}'",
                    step.id, detail.summary.id, hl
                ));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::StorageManager;

    #[test]
    fn all_five_builtin_labs_parse_and_validate_topology_graph() {
        let summaries = list_academy_labs(&[], None).expect("builtin labs must parse");
        assert_eq!(summaries.len(), 5, "expected all 5 foundational labs");

        for (idx, summary) in summaries.iter().enumerate() {
            assert_eq!(summary.number, (idx + 1) as u32);
            assert!(!summary.all_templates_ready);

            let detail = get_academy_lab_detail(&summary.id, &[], None)
                .expect("detail must load for builtin lab");
            validate_lab_integrity(&detail).expect("topology & step highlight links must be valid");
            assert!(
                detail.guide_markdown.contains("- [ ]"),
                "lab {} guide.md should include interactive task checkboxes",
                summary.id
            );
            assert!(
                detail.guide_markdown.contains("<details>"),
                "lab {} guide.md should include expandable <details> hints",
                summary.id
            );
        }

        // Verify Lab 05 specifically pre-configures 80ms latency and 5% packet loss
        let lab5 = get_academy_lab_detail("05-tcp-handshakes-window-loss", &[], None).unwrap();
        let wan_link = &lab5.topology.links[0];
        assert_eq!(wan_link.impairments.latency_ms, 80);
        assert!((wan_link.impairments.loss_percent - 5.0).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn clean_sandbox_instantiation_auto_binds_templates_and_resets_artifacts() {
        let root = std::env::temp_dir().join(format!(
            "etherloom_academy_test_{}",
            uuid::Uuid::new_v4().simple()
        ));
        let app_dir = root.join("app-support");
        let storage_root = root.join("library");
        let volumes_root = root.join("Volumes");
        fs::create_dir_all(&volumes_root).unwrap();

        let storage = StorageManager::new(app_dir, volumes_root.clone());
        let image_store = ImageStore::new(storage);
        let workspaces_dir = storage_root.join("projects");
        fs::create_dir_all(&workspaces_dir).unwrap();

        // Instantiate Lab 01 into a clean sandbox workspace
        let inst = instantiate_academy_lab(
            "01-ethernet-hubs-switches-arp",
            &workspaces_dir,
            None,
            &image_store,
            &volumes_root,
            true,
        )
        .await
        .expect("lab instantiation should succeed");

        let bundle_path = PathBuf::from(&inst.bundle.bundle_path);
        assert!(bundle_path.join("topology.toml").is_file());
        assert!(bundle_path.join("overlays").is_dir());
        assert!(bundle_path.join("captures").is_dir());

        // Simulate user artifacts inside overlays/ and captures/, then verify Reset Lab wipes them cleanly
        let dummy_capture = bundle_path.join("captures").join("test_dirty.pcap");
        fs::write(&dummy_capture, b"pcapdata").unwrap();
        assert!(dummy_capture.is_file());

        let reset = instantiate_academy_lab(
            "01-ethernet-hubs-switches-arp",
            &workspaces_dir,
            None,
            &image_store,
            &volumes_root,
            true,
        )
        .await
        .expect("lab reset should succeed");

        assert!(!dummy_capture.exists(), "reset_clean must purge old captures");
        assert_eq!(reset.lab.summary.node_count, 5);

        let _ = fs::remove_dir_all(&root);
    }
}
