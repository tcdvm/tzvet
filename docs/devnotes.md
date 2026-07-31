# TAMU-specific parsing

For TAMU, the extraction flow starts in extract-lab-trends.js by resolving the tenant profile from the hostname via lab-tenant-profiles.js. If the host matches tamu.ezyvet.com, tamu.use1.ezyvet.com, or tamu.use2.ezyvet.com, the parser gets the TAMU profile, which points at the same DOM selectors as other tenants but uses TAMU-specific panel/test aliases and one parsing override: extractTamuPanelFromOutcomeLine in lab-tenant-profiles.js.

From there, if the active tab is the clinical tab, the extractor looks inside the Medicalnotes container div[id^="medicalnotesNotes"] in extract-lab-trends.js. It finds the table, walks each tr, and only keeps rows that contain a nested table. For each such row, it strips out the nested table text to get the row “header” text, then parses that with parseRowText(...) in extract-lab-trends.js. That parsing step extracts:

- sampleDate from Result Date: or from row cells
- reference from Reference: ...
- panel using extractPanelFromLines(...)
- species

The TAMU-specific part is inside extractPanelFromLines(...) in extract-lab-trends.js. For TAMU, it calls extractTamuPanelFromOutcomeLine(...) first. That function scans the row’s text lines, finds a line matching Reference: US...-DR..., then walks forward looking for the next plausible panel label while skipping noise like blank lines, Lab..., Reference..., Images, and Outcomes in lab-tenant-profiles.js. If it finds one, that becomes the raw panel name. If it does not find one, TAMU intentionally returns null instead of falling back to the generic clinic-notes parser in extract-lab-trends.js. That is a TAMU-specific behavior and means a TAMU note row is dropped from panelRows unless this outcome-line extraction succeeds.

After raw rows are collected, panelRows = rows.filter((row) => row.meta?.panel) in extract-lab-trends.js, so only rows with a parsed panel move forward. Then buildObservations(...) in extract-lab-trends.js processes each nested table. It first rejects a TAMU-only placeholder panel if any nested row starts with Hold Status via isHoldStatusPlaceholder(...) in extract-lab-trends.js. Then it canonicalizes the raw panel name using TAMU’s alias groups from lab-tenant-profiles.js, mapping things like hematology request to CBC, chemistry (2) or mini panel to Chemistry, and urinalysis (3) to Urinalysis.

Within each nested results table, each non-header row is parsed by parseObservationRow(...) in extract-lab-trends.js into:

- testName
- valueRaw
- unit
- lowestValue
- highestValue
- qualifier

Then the test name is canonicalized with TAMU’s test aliases from lab-tenant-profiles.js, so variants like SGPT become Alanine aminotransferase, PCV can become Packed Cell Volume (Spun), and so on. Final observation objects are assembled with the panel, original panel label, canonical names, date, reference, species, and parsed result fields in extract-lab-trends.js.

So the short TAMU flow is:

1. Detect TAMU tenant by hostname.
2. Enter the active clinical Medicalnotes container.
3. Walk Medicalnotes table rows that contain nested result tables.
4. Parse each row’s metadata.
5. For TAMU, derive the panel name specifically from the lines following Reference: US...-DR
6. Drop the row entirely if no TAMU panel is found.
7. Canonicalize panel and test names using TAMU alias lists.
8. Skip TAMU Hold Status placeholders.
9. Emit normalized observations for the trends UI.

The main TAMU-specific risk point is step 5: if TAMU changes the text pattern around Reference: or the panel label no longer appears in the expected position, the row never becomes a panelRow, so none of its labs make it into the final observations.