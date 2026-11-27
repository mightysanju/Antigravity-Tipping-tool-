-- Step 5: Daily assignments (context, save with mid-day reassignment). FT-10/11/12/14 gated.

-- Caller must be super admin, property admin of the property, or a department manager of a
-- housekeeping department in that property (FT-15 must be on for managers).
CREATE OR REPLACE FUNCTION public.assert_assignment_manager(p_property_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
  v_is_hk BOOLEAN;
  v_ft15 BOOLEAN;
BEGIN
  IF public.auth_is_super_admin() THEN
    RETURN;
  END IF;
  SELECT * INTO v_ap FROM public.auth_active_person();
  IF v_ap.id IS NULL OR v_ap.property_id <> p_property_id THEN
    RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_ap.role = 'property_admin' THEN
    RETURN;
  END IF;
  IF v_ap.role = 'dept_manager' THEN
    SELECT d.is_housekeeping INTO v_is_hk FROM public.departments d
    WHERE d.id = v_ap.department_id AND d.property_id = p_property_id;
    SELECT enabled INTO v_ft15 FROM public.property_features
    WHERE property_id = p_property_id AND feature_key = 'department_manager_role';
    IF COALESCE(v_is_hk, false) AND COALESCE(v_ft15, false) THEN
      RETURN;
    END IF;
  END IF;
  RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_assignment_manager(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_assignment_manager(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_assignment_context(p_property_id UUID, p_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prop RECORD;
  v_today DATE;
  v_rooms JSONB;
  v_hks JSONB;
  v_assign JSONB;
  v_counts JSONB;
  v_toggles JSONB;
BEGIN
  PERFORM public.assert_assignment_manager(p_property_id);

  SELECT id, name, timezone INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF v_prop.id IS NULL THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  v_today := (now() AT TIME ZONE v_prop.timezone)::DATE;

  SELECT COALESCE(jsonb_agg(r.room_number ORDER BY
    CASE WHEN r.room_number ~ '^[0-9]+$' THEN 0 ELSE 1 END,
    CASE WHEN r.room_number ~ '^[0-9]+$' THEN r.room_number::NUMERIC ELSE 0 END,
    r.room_number), '[]'::JSONB)
  INTO v_rooms FROM public.rooms r WHERE r.property_id = p_property_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pe.id, 'name', pe.name) ORDER BY pe.name), '[]'::JSONB)
  INTO v_hks
  FROM public.people pe
  JOIN public.departments d ON d.property_id = pe.property_id AND d.id = pe.department_id
  WHERE pe.property_id = p_property_id AND pe.role = 'staff' AND pe.status = 'active' AND d.is_housekeeping;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'roomNumber', a.room_number,
    'personId', a.person_id,
    'personName', pe.name,
    'source', a.source,
    'reassignedFromPersonId', a.reassigned_from_person_id
  ) ORDER BY
    CASE WHEN a.room_number ~ '^[0-9]+$' THEN 0 ELSE 1 END,
    CASE WHEN a.room_number ~ '^[0-9]+$' THEN a.room_number::NUMERIC ELSE 0 END,
    a.room_number), '[]'::JSONB)
  INTO v_assign
  FROM public.assignments a
  JOIN public.people pe ON pe.property_id = a.property_id AND pe.id = a.person_id
  WHERE a.property_id = p_property_id AND a.assignment_date = p_date;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('personId', x.person_id, 'name', x.name, 'roomCount', x.cnt)
    ORDER BY x.name), '[]'::JSONB)
  INTO v_counts
  FROM (
    SELECT a.person_id, pe.name, COUNT(*)::INT AS cnt
    FROM public.assignments a
    JOIN public.people pe ON pe.property_id = a.property_id AND pe.id = a.person_id
    WHERE a.property_id = p_property_id AND a.assignment_date = p_date
    GROUP BY a.person_id, pe.name
  ) x;

  SELECT COALESCE(jsonb_object_agg(f.feature_key, f.enabled), '{}'::JSONB)
  INTO v_toggles
  FROM public.property_features f
  WHERE f.property_id = p_property_id
    AND f.feature_key IN ('pdf_assignment_upload', 'camera_photo_ocr', 'manual_assignment', 'mid_day_reassignment');

  RETURN jsonb_build_object(
    'propertyName', v_prop.name,
    'timezone', v_prop.timezone,
    'today', v_today,
    'date', p_date,
    'rooms', v_rooms,
    'housekeepers', v_hks,
    'assignments', v_assign,
    'counts', v_counts,
    'toggles', v_toggles
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_assignment_context(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_assignment_context(UUID, DATE) TO authenticated;

-- Used by the parse step (feature gate for the input method only; nothing is saved).
CREATE OR REPLACE FUNCTION public.assert_assignment_source_enabled(p_property_id UUID, p_source TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_key TEXT;
  v_id TEXT;
  v_on BOOLEAN;
BEGIN
  PERFORM public.assert_assignment_manager(p_property_id);
  v_key := CASE p_source
    WHEN 'pdf' THEN 'pdf_assignment_upload'
    WHEN 'photo' THEN 'camera_photo_ocr'
    WHEN 'manual' THEN 'manual_assignment'
    ELSE NULL END;
  v_id := CASE p_source WHEN 'pdf' THEN 'FT-10' WHEN 'photo' THEN 'FT-11' WHEN 'manual' THEN 'FT-12' ELSE NULL END;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_ASSIGNMENT_SOURCE' USING ERRCODE = '22023';
  END IF;
  SELECT enabled INTO v_on FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = v_key;
  IF NOT COALESCE(v_on, false) THEN
    RAISE EXCEPTION 'FEATURE_DISABLED:%', v_id USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_assignment_source_enabled(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_assignment_source_enabled(UUID, TEXT) TO authenticated;

-- Saves reviewed assignments atomically. Existing room/date rows assigned to someone else are
-- reassigned (needs FT-14) and keep reassigned_from_person_id; earlier tips stay with the original.
CREATE OR REPLACE FUNCTION public.save_assignments(
  p_property_id UUID,
  p_date DATE,
  p_source TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prop RECORD;
  v_today DATE;
  v_item JSONB;
  v_room TEXT;
  v_person UUID;
  v_existing RECORD;
  v_saved INT := 0;
  v_reassigned INT := 0;
  v_unchanged INT := 0;
  v_ft14 BOOLEAN;
  v_seen TEXT[] := ARRAY[]::TEXT[];
  v_actor UUID := auth.uid();
BEGIN
  PERFORM public.assert_assignment_source_enabled(p_property_id, p_source);

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'NO_ASSIGNMENTS' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 1000 THEN
    RAISE EXCEPTION 'TOO_MANY_ASSIGNMENTS_MAX_1000' USING ERRCODE = '22023';
  END IF;

  SELECT id, status, timezone INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF v_prop.id IS NULL THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  v_today := (now() AT TIME ZONE v_prop.timezone)::DATE;
  IF p_date < v_today THEN
    RAISE EXCEPTION 'ASSIGNMENT_DATE_IN_PAST' USING ERRCODE = '22023';
  END IF;
  IF p_date > v_today + 60 THEN
    RAISE EXCEPTION 'ASSIGNMENT_DATE_TOO_FAR' USING ERRCODE = '22023';
  END IF;

  SELECT enabled INTO v_ft14 FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = 'mid_day_reassignment';

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_room := btrim(COALESCE(v_item->>'roomNumber', ''));
    BEGIN
      v_person := (v_item->>'personId')::UUID;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'INVALID_HOUSEKEEPER' USING ERRCODE = '22023';
    END;

    IF v_room = ANY (v_seen) THEN
      RAISE EXCEPTION 'DUPLICATE_ROOM_IN_REQUEST:%', v_room USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_room);

    IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE property_id = p_property_id AND room_number = v_room) THEN
      RAISE EXCEPTION 'ROOM_NOT_FOUND:%', v_room USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.people pe
      JOIN public.departments d ON d.property_id = pe.property_id AND d.id = pe.department_id
      WHERE pe.id = v_person AND pe.property_id = p_property_id
        AND pe.role = 'staff' AND pe.status = 'active' AND d.is_housekeeping
    ) THEN
      RAISE EXCEPTION 'INVALID_HOUSEKEEPER' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_existing FROM public.assignments
    WHERE property_id = p_property_id AND assignment_date = p_date AND room_number = v_room
    FOR UPDATE;

    IF v_existing.id IS NULL THEN
      INSERT INTO public.assignments (property_id, assignment_date, room_number, person_id, source, assigned_by)
      VALUES (p_property_id, p_date, v_room, v_person, p_source, v_actor);
      v_saved := v_saved + 1;
    ELSIF v_existing.person_id = v_person THEN
      v_unchanged := v_unchanged + 1;
    ELSE
      IF NOT COALESCE(v_ft14, false) THEN
        RAISE EXCEPTION 'FEATURE_DISABLED:FT-14' USING ERRCODE = '42501';
      END IF;
      UPDATE public.assignments
      SET person_id = v_person,
          reassigned_from_person_id = v_existing.person_id,
          source = p_source,
          assigned_by = v_actor,
          updated_at = now()
      WHERE id = v_existing.id;
      v_saved := v_saved + 1;
      v_reassigned := v_reassigned + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('savedCount', v_saved, 'reassignedCount', v_reassigned, 'unchangedCount', v_unchanged);
END;
$$;

REVOKE ALL ON FUNCTION public.save_assignments(UUID, DATE, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_assignments(UUID, DATE, TEXT, JSONB) TO authenticated;
