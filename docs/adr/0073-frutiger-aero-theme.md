# ADR 0073: A "Frutiger Aero" theme, and a themeable accent

## Status

Accepted, implemented. Extends `docs/adr/0042-tenant-theme-system.md`.

## Context

The owner asked for a third theme in the Frutiger Aero style: the glossy,
sky-and-water look of mid-2000s interfaces (Windows Vista/7, early
smartphones). The style is defined by:

- blue skies, water and green;
- translucent glass;
- glossy highlights on buttons;
- bubbles;
- a humanist sans.

The theme system of ADR 0042 switched only the neutral palette. The accent
(indigo/violet) was deliberately fixed as the brand identity. An Aero
theme in indigo wouldn't be Aero.

## Decision

- **The accent becomes themeable, the same way as the neutrals.**
  - `tailwind.config.js` maps `indigo-*` to `var(--a-*)` and `violet-*` to
    `var(--v-*)`.
  - `:root` sets those variables to Tailwind's exact indigo and violet hex
    values, so the default and "refined" themes are unchanged.
  - Only `[data-theme='aero']` overrides them, with a sky-blue accent and
    an aqua-green secondary.
  - No component file changed for the accent, as with the neutrals in
    ADR 0042.
  - One hardcoded accent (the ticket-volume chart's bar fill) now uses the
    variable.
- **Aero's look lives in CSS under `[data-theme='aero']`** in `index.css`:
  - **Sky:** a sky-to-grass gradient on the body, with decorative bubbles
    (a ring and a highlight) on a fixed `body::before` layer.
  - **Neutrals:** a cool, slightly translucent palette, so the page
    background (`slate-50`) lets the sky through.
  - **Glass:** white panels (`.bg-white`) become frosted glass: 70% white
    with a backdrop blur.
  - **Gloss:** the primary accent (`bg-indigo-600`) gets a top-half gloss,
    an inner highlight and a soft glow; the active nav item gets a light
    glossy wash.
  - **Font:** Segoe UI first (Frutiger and Myriad if present), falling back
    to the app's usual font.
- **Legibility.** Text sits on panels that are at least 70% white. White
  text on the glossy buttons sits on `#0879b5`, which clears 4.5:1.
  `prefers-reduced-transparency` turns the glass solid white. A frosted
  field forms its own stacking context, so overlaid icons (search
  magnifiers) are lifted above it.
- **Server:** `aero` joins `UI_THEMES`. The existing validation, RLS
  scoping and per-tenant storage need nothing new.

## Consequences

- A future theme can recolor the accent as well as the neutrals, with no
  component changes.
- Aero's glass uses `backdrop-filter` on every white panel. That's fine
  on current hardware; a very slow machine can pick another theme.
- The font stack means Aero looks most like itself on Windows. Elsewhere
  it keeps the app's own font with the same colors and glass.

## Verified

- `apps/api/test/ui-settings.test.ts` still passes: `aero` is a valid key
  and the other two themes still resolve.
- In the browser, choosing Frutiger Aero under Settings → Appearance
  applied `data-theme="aero"` right away. Checked on:
  - the dashboard, tickets, a ticket, Settings, notification settings, a
    modal, and the phone-width ticket list;
  - the sky gradient, bubbles, frosted panels, the glossy primary button
    (`rgb(8, 121, 181)`) and the aqua chart bar.

  No console errors. The default theme's accent variables are the exact
  indigo hex values, so it renders as before.
