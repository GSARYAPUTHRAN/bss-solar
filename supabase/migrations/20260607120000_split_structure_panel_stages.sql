-- Split "Structure Fabrication & Panel Installation" into two milestones.

ALTER TYPE project_stage ADD VALUE IF NOT EXISTS 'structure_fabrication';
ALTER TYPE project_stage ADD VALUE IF NOT EXISTS 'panel_installation';

-- Rename existing combined milestone -> structure fabrication
UPDATE project_milestones
SET stage = 'structure_fabrication'
WHERE stage = 'structure_fabrication_installation';

-- Make room for panel installation (sort_order 6)
UPDATE project_milestones SET sort_order = 9 WHERE stage = 'plant_commissioning';
UPDATE project_milestones SET sort_order = 8 WHERE stage = 'kseb_inspection_meter';
UPDATE project_milestones SET sort_order = 7 WHERE stage = 'wcr_submitted';

-- Add panel installation milestone per project (inherits completion if structure was done)
INSERT INTO project_milestones (project_id, stage, sort_order, status, completed_at)
SELECT
  pm.project_id,
  'panel_installation',
  6,
  CASE WHEN pm.status = 'completed' THEN 'completed'::milestone_status ELSE 'pending'::milestone_status END,
  CASE WHEN pm.status = 'completed' THEN pm.completed_at ELSE NULL END
FROM project_milestones pm
WHERE pm.stage = 'structure_fabrication'
ON CONFLICT (project_id, stage) DO NOTHING;

UPDATE projects
SET current_stage = 'structure_fabrication'
WHERE current_stage = 'structure_fabrication_installation';

CREATE OR REPLACE FUNCTION seed_project_milestones()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO project_milestones (project_id, stage, sort_order) VALUES
    (new.id, 'site_feasibility_survey', 1),
    (new.id, 'kseb_portal_registration', 2),
    (new.id, 'kseb_feasibility_clearance', 3),
    (new.id, 'material_dispatch', 4),
    (new.id, 'structure_fabrication', 5),
    (new.id, 'panel_installation', 6),
    (new.id, 'wcr_submitted', 7),
    (new.id, 'kseb_inspection_meter', 8),
    (new.id, 'plant_commissioning', 9);
  RETURN new;
END; $$;
