# Anthropic's mod documentation, saved for reference

These ten pages are Anthropic's Claude Code mod documentation, saved as Markdown from
https://code.claude.com/docs/en/plugins/mods/ (each page's first lines point to the docs index). They
are kept as fetched, so this repo's mods can be checked against them: issue #119 is the first such
audit. The one change from the fetched text: links to other docs pages are written site-relative
(`/docs/en/hooks`), as the first copy had them, so a refresh's diff shows only what the pages say.

The first nine were saved on 2026-10-21 (commit 8eb8cfe) and refreshed on 2026-10-25, when
`Manage-mods-for-your-organization.md` was added. A SPEC that cites a page by line before the refresh
means that page as of 8eb8cfe (`git show 8eb8cfe:"docs/research/Mods/<page>"`).

The live pages change between Claude Code releases. When a page here, the live page and the types
Claude Code writes for your build disagree, trust the types first, then the live page. Many entries name
the Claude Code version they need, such as 2.1.299 or 2.1.304. CI runs 2.1.296, so check the version
before a mod relies on one.

| Page | Live URL |
| :- | :- |
| `Mods-overview.md` | https://code.claude.com/docs/en/plugins/mods/overview |
| `Create-a-mod.md` | https://code.claude.com/docs/en/plugins/mods/create |
| `Manage-mods-for-your-organization.md` | https://code.claude.com/docs/en/plugins/mods/admin |
| `Build/Draw-in-the-interface-with-a-mod.md` | https://code.claude.com/docs/en/plugins/mods/interface |
| `Build/Interface-gallery-for-mods.md` | https://code.claude.com/docs/en/plugins/mods/gallery |
| `Build/React-to-events-with-a-mod.md` | https://code.claude.com/docs/en/plugins/mods/events |
| `Build/Use-the-mods-API.md` | https://code.claude.com/docs/en/plugins/mods/api |
| `Test and troubleshoot/Mods-reference.md` | https://code.claude.com/docs/en/plugins/mods/reference |
| `Test and troubleshoot/Test-a-mod.md` | https://code.claude.com/docs/en/plugins/mods/test |
| `Test and troubleshoot/Troubleshoot-a-mod.md` | https://code.claude.com/docs/en/plugins/mods/troubleshoot |
