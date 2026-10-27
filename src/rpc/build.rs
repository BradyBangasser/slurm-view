fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let proto_dir = manifest_dir.join("../../proto");
    let proto_file = proto_dir.join("slurmview.proto");

    tonic_prost_build::configure()
        .compile_protos(&[&proto_file], &[&proto_dir])?;

    Ok(())
}