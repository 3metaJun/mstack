# Host drivers: T3 Code

Use this only when you run inside T3 Code and its `t3-code` MCP tools are
present. Tool names can carry a harness prefix such as `mcp__t3_code__`. If a
scan finds none, make one bounded call to `orchestrator_capabilities` before
concluding they are absent. Without the tools, use the drivers in
[harness-paths.md](../harness-paths.md).

These tools are drivers that satisfy a contract's Drive and Evidence sections.
They do not replace a repository's own Playwright, PTY, or API harness when the
contract names one. Record in the run evidence which driver ran. Keep these tool
names out of the canonical contract and the wrappers, which must stay portable.

## Browser

The `preview_*` tools drive a browser tab that the user can watch.

1. Call `preview_status`. If no automation-capable tab is attached, call
   `preview_open` before concluding the browser is unavailable. Use another
   browser only when the `preview_*` tools are absent, the user asks for one, or
   `preview_open` reports it unsupported.
2. `preview_navigate` takes a `url`, or `target:{kind:"environment-port",
   port:<n>}` for a dev server. Exactly one of the two.
3. `preview_snapshot` returns the page state, semantic elements, diagnostics, and
   a screenshot. Take interaction locators from it. Prefer them to coordinates,
   matching the contract's rule on stable selectors. Then drive with
   `preview_click`, `preview_type` (`clear:true` replaces text),
   `preview_press`, `preview_scroll`, and `preview_wait_for`. `preview_evaluate`
   can mutate page state, so it is a read path only when the expression only
   reads.
4. `preview_resize` and `preview_set_appearance` cover viewport and
   light or dark checks.
5. Evidence. `preview_snapshot` with `save:true` writes the PNG and returns a
   `screenshotPath`. `preview_recording_start` then `preview_recording_stop`
   returns an environment-local path to a recording up to 50 MiB. Copy either into
   the contract's retained artifact location. Do not leave proof only in the tool
   result, which is not saved.

## Mobile simulator

`device_list` shows the iOS Simulators and Android Emulators, and which hosts can
run them. `device_open` boots one, shows it in the user's Device panel, and
returns the `agent-device` CLI invocation pinned to it. Tapping, typing,
installing, and reading logs go through that CLI. `device_screenshot` returns the
screen as an image and can be registered separately from the other `device_*`
tools, so fall back to the CLI's own screenshot when it is absent.
`device_close` removes the device from the panel. Pass `shutdown:true` only for a
device this run booted, so Cleanup stops only what the run created.

## Not available

If neither toolset is attached, try the applicable portable or repository-owned
driver first, as [harness-paths.md](../harness-paths.md) describes. Declare the
interaction blocked only when no available driver can perform it, as the main
workflow requires. A unit test or an HTTP response does not replace a required UI
interaction.
