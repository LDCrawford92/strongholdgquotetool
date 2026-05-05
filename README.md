# Stronghold Quote Web

Production-ready Next.js port of the SwiftUI Stronghold quote generator.

## Commands

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Supabase

Create `.env.local` with:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

The frontend uses only the anon/public key. Do not add a service role key to this app.

## Pricing Logic

The pricing engine lives in `src/lib/pricing`.

- Matrix pricing rounds pole centre and drop up to the first matching catalogue size.
- Metres, millimetres, and feet/inches use the same conversions as the SwiftUI app.
- Print is calculated as `poleCentreMetres * dropMetres * 2 * 14`.
- Sticky tape, fitting, and delivery are fixed add-on charges.
- Coil Carriers calculate length in metres from metres, millimetres, or feet/inches, then add optional rear door, drip sheet per-metre, flickers, and Rhino fitting charges.
- The main menu includes Curtains, Coil Carriers, Pricing Sheets, History, and Settings.
- Pricing Sheets loads from `public.price_sheets`, seeds defaults from the hardcoded catalogue if empty, and saves edits back to Supabase after unlocking with the internal edit password.
- Coil Carrier pricing uses `public.pricing_settings`. Run `supabase/pricing_settings.sql` once to add or update the editable rate fields.
- Generated quotes can be saved to `public.saved_quotes` for the logged-in Supabase user.
- The History tab hides expired quotes and removes expired rows for the current user on load.
