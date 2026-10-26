# Generated character portrait atlases

Twenty transparent WebP atlases cover ten themes in flat and pixel styles, sharing eighty character identities.
Each atlas has four columns and two rows; character order follows the canonical
IDs in `src/portrait-manifest.json`. Custom uploads override these default images.

The illustrations were created for this plugin with the built-in `image_gen`
tool, using hand-painted collectible portraits, theme-appropriate clothing and
props, aligned cells, transparent backgrounds, and no labels or watermarks.
No remote image service is required at runtime. The build verifies dimensions,
byte budgets and SHA-256 before copying assets into the package.

The original generated PNGs are mechanically encoded as small transparent WebP
files for display; this does not change their character designs. Animation is
applied in the client, and follows reduced-motion settings.
