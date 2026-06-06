-- Migrate legacy DBs that still have the combined milestone stage.
-- Fresh installs already use structure_fabrication + panel_installation from init.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'project_stage' AND e.enumlabel = 'structure_fabrication_installation'
  ) THEN
    RETURN;
  END IF;

  ALTER TYPE project_stage ADD VALUE IF NOT EXISTS 'structure_fabrication';
  ALTER TYPE project_stage ADD VALUE IF NOT EXISTS 'panel_installation';
END $$;

-- Enum values must be committed before use; run data migration in a separate block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM project_milestones WHERE stage::text = 'structure_fabrication_installation'
  ) THEN
    RETURN;
  END IF;

  UPDATE project_milestones
  SET stage = 'structure_fabrication'
  WHERE stage::text = 'structure_fabrication_installation';

  UPDATE project_milestones SET sort_order = 9 WHERE stage = 'plant_commissioning';
  UPDATE project_milestones SET sort_order = 8 WHERE stage = 'kseb_inspection_meter';
  UPDATE project_milestones SET sort_order = 7 WHERE stage = 'wcr_submitted';

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
  WHERE current_stage::text = 'structure_fabrication_installation';
END $$;

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
