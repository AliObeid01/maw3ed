Maw3ed logo (PR-16b). Source of truth: maw3ed-logo-light.svg, the owner's file (viewBox -8 2 469.53 141.04).
Everything else is generated from it:  node scripts/design/build-logo-assets.mjs

maw3ed-logo-light.svg      Full logo for white surfaces (navy wordmark).
maw3ed-logo-reverse.svg    Full logo for navy surfaces: white wordmark; the icon body is a lighter navy (#16295E) with a faint white outline (22 %, 1.2 units) so it stays visible on navy. Same geometry.
maw3ed-icon.svg            The calendar-M icon alone, viewBox 0 0 64 64 (also src/app/icon.svg and favicon/favicon.svg).
maw3ed-icon-reverse.svg    The icon with the reverse body, used for the maskable app icon.
maw3ed-wordmark-*.svg      The written name only (light, reverse), for spots too small for the icon.
maw3ed-logo-*-1200w.png    Raster previews, 1200 x 360, transparent.
app/                       app-icon 192, 512, 1024 (icon on transparent), maskable 512 (reverse icon at 60 % on solid navy, inside the safe zone), apple-touch-icon 180 (icon on white). Shipped copies: public/brand and src/app/apple-icon.png.
email/                     Email header logos, light and reverse, 160w (160x48), 320w and 480w for retina. Show the 160w size; the email uses the reverse 320w on the navy band. Copies live in public/brand.
favicon/                   favicon.ico (16, 32, 48 PNG entries, written by the script without a package), favicon.svg, favicon-16/32/48.png. Shipped copy: src/app/favicon.ico.
whatsapp-profile-640.png   WhatsApp profile picture, icon on white, 640 px.

Calendar files (.ics) cannot show a logo in most calendar apps, so they carry the plain name Maw3ed.
Colours: Deep Navy #0B1938, Turquoise #21CDB3, Electric Blue #2864F5, White #FFFFFF, reverse body #16295E.
No fonts: the wordmark letters are outlined paths.
