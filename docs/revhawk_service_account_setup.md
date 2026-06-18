# Setting up the BigQuery service account for the live RevHawk sync

Goal: create a Google Cloud "service account" (a robot login) and a key file, so
RevHawk can grant it read access to your data and the app can pull it live every
morning. No coding — just clicking through the Google Cloud Console.

You'll do Parts A–D. Part E (wiring it into the app) is done with me afterward.

Plan on ~15 minutes. Have a credit card handy for Part A (you won't be charged —
the usage is free-tier; Google just requires a card on file).

---

## Part A — Create a Google Cloud project

1. Go to **https://console.cloud.google.com** and sign in with your work Google
   account.
2. At the very top, click the **project dropdown** (says "Select a project" or
   shows a current project name) → **New Project**.
3. Name it something like **`ridd-data`** → **Create**.
4. When it finishes (a few seconds), make sure that new project is **selected** in
   the top dropdown before continuing.
5. **Turn on billing** (required for BigQuery to run queries):
   - Left menu (☰) → **Billing**.
   - If it says no billing account, click **Link a billing account** → **Create
     billing account**, enter your card, and link it to the `ridd-data` project.
   - Reassurance: the daily query reads a few megabytes. Google gives 1 TB of
     query free every month, so this will cost effectively **$0**. The card is
     just Google's requirement to enable the service.

---

## Part B — Create the service account

1. Left menu (☰) → **IAM & Admin** → **Service Accounts**.
2. Click **+ Create service account** at the top.
3. **Service account name:** `revhawk-reader` → click **Create and continue**.
4. **Grant this service account access to project:** in the **Role** box, search
   for and select **BigQuery Job User**. Click **Continue**.
   - (This lets it *run* queries in your project. The access to RevHawk's actual
     data is granted by RevHawk on their side in Part D.)
5. Click **Done**.

You'll now see `revhawk-reader@ridd-data.iam.gserviceaccount.com` (your exact name
may differ slightly) in the list. **That email address is what RevHawk needs.**

---

## Part C — Create the key file

1. In the Service Accounts list, click the **`revhawk-reader`** account you just
   made.
2. Go to the **Keys** tab → **Add key** → **Create new key**.
3. Choose **JSON** → **Create**.
4. A `.json` file downloads to your computer. **Keep it safe — it's like a
   password.** Don't email it or post it anywhere.

That file contains two things we'll need later: `client_email` and `private_key`.

---

## Part D — Hand off to RevHawk

Send RevHawk:
- The service account **email** from Part B
  (`revhawk-reader@ridd-data.iam.gserviceaccount.com`).
- Ask them to **grant it read access (BigQuery Data Viewer) to the materialized
  view** that holds your data.

Ask RevHawk to send back **three things** so I can point the app at the right place:
1. The **project** the view lives in (e.g. `revhawkdataconnect`).
2. The **dataset** name (e.g. `org_ridd_pest_control_3f4149`).
3. The **view/table name** (the materialized view that holds the data) — and, if
   easy, the **list of columns** in it.

---

## Part E — Finish with me (after Parts A–D)

Once RevHawk confirms access and sends the view name, tell me and I'll:
- Point the sync function at that view and adjust the query if the view's shape
  differs from the tables I mapped.
- Re-enable the daily morning schedule.

Then you'll add **five values** in Netlify (Site settings → Environment
variables). I'll give you the exact names; you'll paste in:
- `GCP_SA_EMAIL` — the `client_email` from the JSON file
- `GCP_SA_PRIVATE_KEY` — the `private_key` from the JSON file (paste the whole
  `-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----` block)
- `GCP_JOB_PROJECT` — your project id (`ridd-data`)
- `REVHAWK_DATASET` and `REVHAWK_VIEW` — from what RevHawk sends back

After that, deploy, run one test, and it's live — fresh data every morning, no
more manual imports.

---

### Notes
- The key is **read-only** for your data — it can look, never change or delete.
- If you ever want to revoke it, delete the key (or the service account) in the
  same Service Accounts screen, and it stops working immediately.
- You can open the downloaded `.json` in any text editor to copy the two values
  when we get to Part E — or just hand it to me and I'll pull them out (it's
  sensitive, so prefer pasting straight into Netlify if you're cautious).
