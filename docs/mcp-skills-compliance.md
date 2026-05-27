# MCP, Skills, Plugins, and Compliance

Grok Desktop is a Grok-first desktop shell. It should not copy community MCP servers, skills, plugins, or marketplace content into the repository unless the license explicitly allows redistribution.

## What Grok Desktop Can Do Safely

- Call the official `grok` CLI by subprocess.
- Display `grok inspect` results so users can see discovered skills, plugins, agents, hooks, MCPs, permissions, and project trust.
- Let Grok discover user-owned local assets from `.grok/`, `~/.grok/`, `.claude/`, and `~/.claude/`.
- Provide UI entry points for MCP/skills status without bundling third-party code.
- Link to official docs and clearly explain attribution/license requirements.

## What Needs Review Before Bundling

- Any community skill, plugin, MCP server, or agent copied into this repo.
- Any marketplace index copied or mirrored into this repo.
- Any code that shells out to a third-party CLI with broad permissions.
- Any MCP server that touches credentials, browsers, filesystem, cloud accounts, production systems, or private data.

Before bundling a community item, confirm:

- License permits redistribution and commercial use if needed.
- Attribution requirements are documented.
- Secrets and credentials are never checked in.
- The tool has a narrow permission surface and clear user approval.
- The UI explains what capability is being enabled.

## Default Product Policy

The default open-source-safe path is: discover and display user-installed Grok-compatible assets, but do not vendor them. Users can install their own plugins/MCP servers through official Grok or Claude-compatible mechanisms.

## References

- xAI Build docs: Skills, Plugins & Marketplaces
- xAI Build docs: Getting Started / `grok inspect`
- Claude docs: MCP vs plugins guidance
