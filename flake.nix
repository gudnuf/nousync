{
  description = "Nousync - P2P session sharing for Claude Code";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  };

  outputs = {nixpkgs, ...}: let
    forAllSystems = fn:
      nixpkgs.lib.genAttrs
      ["aarch64-darwin" "x86_64-linux" "x86_64-darwin" "aarch64-linux"]
      (system: fn nixpkgs.legacyPackages.${system});
  in {
    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_22
        ];

        shellHook = ''
          echo "nousync dev shell"
          echo "node $(node --version) | npm $(npm --version)"
        '';
      };
    });
  };
}
