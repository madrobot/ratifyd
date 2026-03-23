# Instructions for Agents

## Generic

- Always use Typescript over JS
- Always use PNPM over NPM
- Always write comprehensive and hollistic unit and functional tests
- Always ensure the `gh` CLI is installed and authorized
- Always put Claude as sole-author on commits, unless user asks for specific changes, then use Claude as co-author
- Do no be so argreeable, try to push back on ideas and assuptions to discover higher-order problems

## Pull Requests

- Always author pull requests using the Claude Github App as the author
- Always write full and meangingful descriptions on pull requests
- Always run the following before creating a PR, commit any changes:
  - `pnpm run build`
  - `pnpm run lint`
  - `pnpm run format`
  - `pnpm test`

## Getting Started

- Run `pnpm install` first

## Peer Identity Storage

- All roles (owner, moderator, guest) share a single peer identity key: `STORAGE_KEYS.PEER_ID`
- Do NOT add a separate `GUEST_PEER_ID` constant to `STORAGE_KEYS`
- Do NOT add `saveGuestPeerId` or `loadGuestPeerId` helper functions — use `savePeerId` / `loadPeerId` for all roles

## Knowledge Base

- Whenever you work on this code base, always read the `docs/plans/ratifyd-adr.md`
- If you make changes to the architecture of the app, always make necessary changes to `docs/plans/ratifyd-adr.md`
- When asked to implement a Phase _X_ of the implementation plan, refer to `docs/plans/ratifyd-implementation-plan.md`
