# Third-Party Licenses

Non-code assets bundled into the repository that require attribution or
license notice. Runtime libraries (npm packages) carry their own
`LICENSE` files in `node_modules` and are not re-listed here — this
file exists because fonts and other binary assets do not surface their
license through package managers.

## Fonts

### Cormorant Garamond

Variable TrueType font (`CormorantGaramond[wght].ttf`, weight axis only)
bundled at [apps/web/public/fonts/CormorantGaramond.ttf](../apps/web/public/fonts/CormorantGaramond.ttf).

- **Authors:** Catharsis Fonts (github.com/CatharsisFonts/Cormorant)
- **License:** SIL Open Font License, Version 1.1
- **License text:** [apps/web/public/fonts/CormorantGaramond-OFL.txt](../apps/web/public/fonts/CormorantGaramond-OFL.txt)
- **Source:** [github.com/google/fonts — ofl/cormorantgaramond](https://github.com/google/fonts/tree/main/ofl/cormorantgaramond)

Used in the cover typography compositor (`apps/web/lib/server/cover-compositor.ts`)
for book-title rendering. Satori is instructed to select the SemiBold
(weight 600) instance from the variable axis.

### Inter

Variable TrueType font (`Inter[opsz,wght].ttf`, opsz + wght axes)
bundled at [apps/web/public/fonts/Inter.ttf](../apps/web/public/fonts/Inter.ttf).

- **Authors:** Rasmus Andersson (upstream), Google Fonts maintainers
- **License:** SIL Open Font License, Version 1.1
- **License text:** [apps/web/public/fonts/Inter-OFL.txt](../apps/web/public/fonts/Inter-OFL.txt)
- **Source:** [github.com/google/fonts — ofl/inter](https://github.com/google/fonts/tree/main/ofl/inter)

Used in the cover typography compositor for author-credit and blurb
rendering. Satori is instructed to select the Medium (weight 500) and
Regular (weight 400) instances from the variable axes.

## Notes

- Both fonts are OFL 1.1: free to use, modify, embed, and distribute
  including in commercial projects. Attribution via the accompanying
  OFL.txt files satisfies the license obligation.
- If satori's variable-font handling turns out to be unreliable at
  runtime, swap to the static-weight TTFs published at upstream
  (rsms.me/inter for Inter, catharsisfonts.com for Cormorant) and
  update the filenames referenced above.
