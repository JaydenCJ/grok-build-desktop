# Third-Party Notices

Grok Desktop is an integration shell. It does not vendor or copy the source code of browser-use, Grok Build CLI, scrcpy, scrcpy-mcp, or community MCP/skills/plugins. Those tools are invoked as separately installed command-line programs, Python packages, or user-owned Grok-compatible local assets.

## Runtime Integrations

| Project | Use | License | Source |
| --- | --- | --- | --- |
| browser-use | Optional Python browser automation package | MIT | https://github.com/browser-use/browser-use |
| scrcpy | Optional Android display/control CLI detected for future phone-control workflows | Apache-2.0 | https://github.com/Genymobile/scrcpy |
| scrcpy-mcp | Optional Android MCP server detected for future phone-control workflows | MIT | https://github.com/JuanCF/scrcpy-mcp |
| Grok Build CLI | Optional user-installed CLI invoked by subprocess | License/terms depend on the user's installed CLI provider | User installation |
| Grok-compatible skills/plugins/MCP servers | Discovered from user/project configuration through `grok inspect`; not copied into this repo | Depends on each installed item | User/project installation |

## Application Framework Dependencies

| Project | Use | License | Source |
| --- | --- | --- | --- |
| Tauri | Desktop runtime | MIT or Apache-2.0 | https://github.com/tauri-apps/tauri |
| React | UI framework | MIT | https://github.com/facebook/react |
| Vite | Frontend build tool | MIT | https://github.com/vitejs/vite |
| TypeScript | Type checker/compiler | Apache-2.0 | https://github.com/microsoft/TypeScript |
| lucide-react | UI icons | ISC, with some Feather-derived icons under MIT | https://github.com/lucide-icons/lucide |
| Chrome Extension APIs | Browser companion platform | Governed by Google Chrome platform terms, not vendored code | https://developer.chrome.com/docs/extensions |

## Compliance Notes

- Grok Desktop only shells out to optional local tools and does not redistribute them.
- If a future packaged release bundles any third-party binary, its full license text and notices must be included in the release artifact.
- If a future plugin copies third-party code into this repository, add the exact license text and attribution before shipping.
- Grok Build CLI is treated as a user-installed backend. Verify its provider terms before redistributing or bundling it.
