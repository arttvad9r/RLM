{
  description = "OpenCode RLM development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});
    in {
      devShells = forAllSystems (system: pkgs:
        let
          deno295 = pkgs.stdenvNoCC.mkDerivation {
            pname = "deno";
            version = "2.9.5";
            src = pkgs.fetchurl {
              url = if system == "x86_64-linux"
                then "https://github.com/denoland/deno/releases/download/v2.9.5/deno-x86_64-unknown-linux-gnu.zip"
                else "https://github.com/denoland/deno/releases/download/v2.9.5/deno-aarch64-unknown-linux-gnu.zip";
              hash = if system == "x86_64-linux"
                then "sha256-iwEKOxpKAYimfNuKeic0iypQGveK7H/HTyrOFnNo1TA="
                else "sha256-a3yuOo/EOFpZ3qMUb8uLrX/qQjDgrTaoxpKvrLwlS+A=";
            };
            nativeBuildInputs = [ pkgs.unzip pkgs.autoPatchelfHook ];
            buildInputs = [ pkgs.stdenv.cc.cc.lib pkgs.zlib ];
            dontUnpack = true;
            installPhase = ''
              mkdir -p $out/bin
              unzip -j $src deno -d $out/bin
              chmod +x $out/bin/deno
            '';
          };
        in {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              deno295
              pkgs.git
            ];
          };
        }
      );
    };
}
