{
  description = "obsidian-maki — Obsidian plugin dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.pnpm
            pkgs.typescript-language-server # editor LSP (optional but handy)
          ];

          shellHook = ''
            echo "obsidian-maki dev shell — node $(node --version), pnpm $(pnpm --version)"
          '';
        };
      });
    };
}
