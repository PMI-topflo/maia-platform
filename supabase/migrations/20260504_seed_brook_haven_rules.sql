-- Seed Brook Haven rules sections into association_config.
-- Looks up the code by name so no hardcoded value is needed.
INSERT INTO public.association_config (association_code, rules_sections)
SELECT
  a.association_code,
  '[
    "1. Purpose and Scope",
    "2. Dual-Association Community — Brook Haven + Boca Del Mar (rules of BOTH apply)",
    "3. Permitted Use — Residential only; no short-term rentals (Airbnb/VRBO prohibited); max 10 overnight occupants",
    "4. Owner Responsibilities — Register all tenants; provide copy of rules before move-in",
    "5. Tenant & Occupant Approval — Board approval required before move-in; no unauthorized occupancy",
    "6. Lease Requirements — Minimum 12-month term; copy submitted to management before move-in",
    "7. Sales, Resales & Estoppel Letters — Dual estoppel required from Brook Haven AND Boca Del Mar",
    "8. Maintenance Fees — Due 1st of month; late after 10th; delinquency may result in lien",
    "9. Exterior Appearance & Alterations — Written approval from BOTH Boards required before any change",
    "10. Common Areas & Passageways — Must be kept free of obstruction at all times",
    "11. Recreational & Community Facilities — Children under 12 require adult supervision in pool area",
    "12. Parking & Vehicles — Designated spaces only; no trucks >1 ton, RVs, boats, trailers, or motorcycles overnight",
    "13. Noise & Nuisance — Quiet hours: 10 PM–8 AM weekdays; 11 PM–9 AM weekends & holidays",
    "14. Pets & Animals — Must be registered with management; leash required; waste removal mandatory",
    "15. Firearms & Weapons — No discharge anywhere on the property",
    "16. Hazardous Materials — No flammables or explosives beyond normal household use",
    "17. Hurricane Season Preparation — Install shutters, secure terrace items, designate caretaker before departing",
    "18. Garbage & Recycling — Securely wrapped and in designated containers only; no bags in passageways",
    "19. Move-In & Move-Out Procedures — 7-day advance notice; permitted Mon–Fri 8 AM–6 PM only",
    "20. Termite Fumigation Protocol — Mandatory cost-sharing and unit evacuation (48 hrs) when required",
    "21. Deliveries — Association not liable for lost, stolen, or damaged packages",
    "22. Safety & Security — Keep access doors secured; do not share access codes with unauthorized persons",
    "23. Maintenance Requests — Submit to service@topfloridaproperties.com or the online portal",
    "24. Complaints — Must be submitted in writing to management; verbal complaints not acted upon",
    "25. Enforcement & Violations — Fines, suspension of amenities, legal action including attorney fees"
  ]'::jsonb
FROM public.associations a
WHERE a.association_name ILIKE '%brook haven%'
LIMIT 1
ON CONFLICT (association_code)
DO UPDATE SET rules_sections = EXCLUDED.rules_sections;
