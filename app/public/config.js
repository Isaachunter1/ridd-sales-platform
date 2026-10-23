// app/public/config.js — per-deployment settings (window.RIDD_CONFIG).
// Loaded by index.html before the app bundle. These are PUBLIC values (the
// anon key runs in every rep's browser; RLS is the access control), so the
// file is committed; a second deployment is this file with other values and
// an unchanged index.html.
  window.RIDD_CONFIG = {
    // Your project URL (already known from dashboard)
    SUPABASE_URL: "https://iqlrndyuiolbxhhwmsqv.supabase.co",

    // Paste your publishable key here (starts with sb_publishable_ or eyJ...)
    // Settings → API Keys → Publishable and secret API keys → Create new API keys
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_E4X3tlMIH85w4DgcRRT_Fg_DO15Wp9a",

    // Production URL used in Supabase auth email links (invites + password
    // resets). When an admin triggers an invite from a dev server (e.g.
    // localhost:5173), Supabase's emailRedirectTo defaults to the browser's
    // current origin — so the rep gets an email pointing at the admin's
    // localhost and can't open it. Hardcoding this here means email links
    // always work regardless of where the admin happens to be.
    PUBLIC_URL: "https://riddsalesapp.netlify.app",

    // Cosmetic / defaults
    COMPANY_NAME: "RIDD",
    COMPANY_TAGLINE: "SERVICE ABOVE ALL",
    COMPANY_EST: "2020",
  };
