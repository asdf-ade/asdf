# Changelog

## [0.3.0](https://github.com/asdf-ade/asdf/compare/v0.2.0...v0.3.0) (2026-09-17)


### Features

* **browser:** a browser pane an agent drives through agent-browser, opened as a tab ([faa60cc](https://github.com/asdf-ade/asdf/commit/faa60cc30acfb66458b6887a8cc44447c3cd8175))
* **sessions:** a session is one window, one agent, one terminal ([cf333b4](https://github.com/asdf-ade/asdf/commit/cf333b4dffcab159518ef3eb5dc66a71b774946d))
* **sessions:** split panes in any of four directions, and reorder tabs within a strip ([faa60cc](https://github.com/asdf-ade/asdf/commit/faa60cc30acfb66458b6887a8cc44447c3cd8175))
* **shell:** live workspaces, split panes and a shell-driven repo panel ([#24](https://github.com/asdf-ade/asdf/issues/24)) ([0a7451a](https://github.com/asdf-ade/asdf/commit/0a7451a9873e08691af5c045f7e8084e8a13e7b1))
* **terminal:** full-window terminal with native Korean IME on macOS ([#13](https://github.com/asdf-ade/asdf/issues/13)) ([7060ed9](https://github.com/asdf-ade/asdf/commit/7060ed91ea0b3f5c50549420c3fed32a0684e59a))
* **workspace:** give a workspace a folder — open one, clone a repository into one, or start without ([faa60cc](https://github.com/asdf-ade/asdf/commit/faa60cc30acfb66458b6887a8cc44447c3cd8175))


### Bug Fixes

* **browser:** end the views a renderer reload orphans, and name agent sessions per launch ([faa60cc](https://github.com/asdf-ade/asdf/commit/faa60cc30acfb66458b6887a8cc44447c3cd8175))
* **browser:** hand agent-browser the debugging port, so sessions bind instead of timing out ([faa60cc](https://github.com/asdf-ade/asdf/commit/faa60cc30acfb66458b6887a8cc44447c3cd8175))
* **browser:** keep dialogs and drop targets above the native browser view ([faa60cc](https://github.com/asdf-ade/asdf/commit/faa60cc30acfb66458b6887a8cc44447c3cd8175))
* **panel:** fall back to the workspace folder where the shell cannot report its directory ([faa60cc](https://github.com/asdf-ade/asdf/commit/faa60cc30acfb66458b6887a8cc44447c3cd8175))
* **release:** publish electron-builder assets to the release-please release ([#23](https://github.com/asdf-ade/asdf/issues/23)) ([63b7a3f](https://github.com/asdf-ade/asdf/commit/63b7a3f76f544e4a387e11fe2cc53bb15bcce028))
* **sessions:** keep the window on a session of the workspace picked or left ([cf333b4](https://github.com/asdf-ade/asdf/commit/cf333b4dffcab159518ef3eb5dc66a71b774946d))
* **sessions:** make the empty window’s new-terminal button start a session at once ([cf333b4](https://github.com/asdf-ade/asdf/commit/cf333b4dffcab159518ef3eb5dc66a71b774946d))
* **sessions:** number a new session past the highest, so closing one does not repeat a name ([cf333b4](https://github.com/asdf-ade/asdf/commit/cf333b4dffcab159518ef3eb5dc66a71b774946d))

## [0.2.0](https://github.com/asdf-ade/asdf/compare/v0.1.0...v0.2.0) (2026-09-02)


### Features

* scaffold Tauri AI dev environment with quality gates ([c3a28f1](https://github.com/asdf-ade/asdf/commit/c3a28f1ff0efc2acbef24c2067cfd431f14f0397))
* **updater:** add in-app updates and automated releases ([#8](https://github.com/asdf-ade/asdf/issues/8)) ([2f92a13](https://github.com/asdf-ade/asdf/commit/2f92a13596e4ebb7f7aca1d03ab0cdd3d7b1c3c5))


### Refactoring

* adopt layered structure with enforced import boundaries ([de230d4](https://github.com/asdf-ade/asdf/commit/de230d469f8dd2eab22fb3fddac5dc99eac52c8e))
