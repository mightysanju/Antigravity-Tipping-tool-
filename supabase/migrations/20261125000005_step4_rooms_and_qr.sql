-- Step 4: Rooms (single + range), property backdrop, and QR target resolution (FT-6/7/8/9 gated)

-- Shared guard: caller must be super_admin or the property_admin of p_property_id.
CREATE OR REPLACE FUNCTION public.assert_property_admin_or_super(p_property_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
BEGIN
  IF public.auth_is_super_admin() THEN
    RETURN;
  END IF;
  SELECT * INTO v_ap FROM public.auth_active_person();
  IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> p_property_id THEN
    RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_property_admin_or_super(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_property_admin_or_super(UUID) TO authenticated;

-- 1. Rooms listing + QR toggles + template/backdrop info
CREATE OR REPLACE FUNCTION public.list_admin_rooms(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prop RECORD;
  v_rooms JSONB;
  v_toggles JSONB;
BEGIN
  PERFORM public.assert_property_admin_or_super(p_property_id);

  SELECT id, name, template_path, hero_photo_path, qr_position
  INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF v_prop.id IS NULL THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', r.id, 'roomNumber', r.room_number, 'createdAt', r.created_at)
    ORDER BY
      CASE WHEN r.room_number ~ '^[0-9]+$' THEN 0 ELSE 1 END,
      CASE WHEN r.room_number ~ '^[0-9]+$' THEN r.room_number::NUMERIC ELSE 0 END,
      r.room_number
  ), '[]'::JSONB)
  INTO v_rooms
  FROM public.rooms r
  WHERE r.property_id = p_property_id;

  SELECT COALESCE(jsonb_object_agg(f.feature_key, f.enabled), '{}'::JSONB)
  INTO v_toggles
  FROM public.property_features f
  WHERE f.property_id = p_property_id
    AND f.feature_key IN ('room_qr_codes', 'department_qr_codes', 'personal_staff_qr_codes', 'qr_templates');

  RETURN jsonb_build_object(
    'propertyName', v_prop.name,
    'rooms', v_rooms,
    'toggles', v_toggles,
    'templatePath', v_prop.template_path,
    'heroPhotoPath', v_prop.hero_photo_path,
    'qrPosition', v_prop.qr_position
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_rooms(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_admin_rooms(UUID) TO authenticated;

-- 2. Add rooms (single or range pre-expanded by the caller). Idempotent per room number.
CREATE OR REPLACE FUNCTION public.add_admin_rooms(p_property_id UUID, p_numbers TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_num TEXT;
  v_clean TEXT;
  v_added INT := 0;
  v_skipped TEXT[] := ARRAY[]::TEXT[];
  v_count INT;
  v_seen TEXT[] := ARRAY[]::TEXT[];
BEGIN
  PERFORM public.assert_property_admin_or_super(p_property_id);

  IF p_numbers IS NULL OR COALESCE(array_length(p_numbers, 1), 0) = 0 THEN
    RAISE EXCEPTION 'NO_ROOM_NUMBERS' USING ERRCODE = '22023';
  END IF;
  IF array_length(p_numbers, 1) > 500 THEN
    RAISE EXCEPTION 'TOO_MANY_ROOMS_MAX_500' USING ERRCODE = '22023';
  END IF;

  FOREACH v_num IN ARRAY p_numbers LOOP
    v_clean := btrim(COALESCE(v_num, ''));
    IF v_clean !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,11}$' THEN
      RAISE EXCEPTION 'INVALID_ROOM_NUMBER:%', v_clean USING ERRCODE = '22023';
    END IF;
    IF v_clean = ANY (v_seen) THEN
      CONTINUE;
    END IF;
    v_seen := array_append(v_seen, v_clean);

    INSERT INTO public.rooms (property_id, room_number)
    VALUES (p_property_id, v_clean)
    ON CONFLICT (property_id, room_number) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 1 THEN
      v_added := v_added + 1;
    ELSE
      v_skipped := array_append(v_skipped, v_clean);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('addedCount', v_added, 'skippedExisting', to_jsonb(v_skipped));
END;
$$;

REVOKE ALL ON FUNCTION public.add_admin_rooms(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_admin_rooms(UUID, TEXT[]) TO authenticated;

-- 3. Delete a room (blocked when assignment history references it)
CREATE OR REPLACE FUNCTION public.delete_admin_room(p_property_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_room RECORD;
BEGIN
  PERFORM public.assert_property_admin_or_super(p_property_id);

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id AND property_id = p_property_id;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.property_id = p_property_id AND a.room_number = v_room.room_number
  ) THEN
    RAISE EXCEPTION 'ROOM_HAS_ASSIGNMENTS' USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.rooms WHERE id = p_room_id AND property_id = p_property_id;
  RETURN jsonb_build_object('deletedRoomId', p_room_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_admin_room(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_admin_room(UUID, UUID) TO authenticated;

-- 4. Property backdrop (Resort Glassmorphism hero photo) set by property admin after Storage upload
CREATE OR REPLACE FUNCTION public.set_admin_property_backdrop(p_property_id UUID, p_path TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.assert_property_admin_or_super(p_property_id);

  IF p_path IS NOT NULL AND p_path NOT LIKE (p_property_id::TEXT || '/%') THEN
    RAISE EXCEPTION 'BACKDROP_PATH_OUTSIDE_PROPERTY' USING ERRCODE = '42501';
  END IF;

  UPDATE public.properties SET hero_photo_path = NULLIF(p_path, '') WHERE id = p_property_id;
  RETURN jsonb_build_object('propertyId', p_property_id, 'heroPhotoPath', NULLIF(p_path, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.set_admin_property_backdrop(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_admin_property_backdrop(UUID, TEXT) TO authenticated;

-- 5. QR target resolution. Enforces FT-8 (rooms), FT-6 (departments), FT-7 (personal), FT-9 (template).
--    People targets are frontline role='staff' + active only (matches guest recipient eligibility).
CREATE OR REPLACE FUNCTION public.get_qr_targets(p_property_id UUID, p_kind TEXT, p_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prop RECORD;
  v_feature TEXT;
  v_feature_id TEXT;
  v_enabled BOOLEAN;
  v_template_enabled BOOLEAN;
  v_targets JSONB;
  v_all BOOLEAN := (p_ids IS NULL OR COALESCE(array_length(p_ids, 1), 0) = 0);
BEGIN
  PERFORM public.assert_property_admin_or_super(p_property_id);

  IF p_kind NOT IN ('room', 'department', 'person') THEN
    RAISE EXCEPTION 'INVALID_QR_KIND' USING ERRCODE = '22023';
  END IF;

  v_feature := CASE p_kind
    WHEN 'room' THEN 'room_qr_codes'
    WHEN 'department' THEN 'department_qr_codes'
    ELSE 'personal_staff_qr_codes' END;
  v_feature_id := CASE p_kind WHEN 'room' THEN 'FT-8' WHEN 'department' THEN 'FT-6' ELSE 'FT-7' END;

  SELECT enabled INTO v_enabled FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = v_feature;
  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'FEATURE_DISABLED:%', v_feature_id USING ERRCODE = '42501';
  END IF;

  SELECT enabled INTO v_template_enabled FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = 'qr_templates';

  SELECT id, name, template_path, qr_position INTO v_prop
  FROM public.properties WHERE id = p_property_id;
  IF v_prop.id IS NULL THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF p_kind = 'room' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', 'room', 'label', 'Room ' || r.room_number, 'sublabel', ''
    ) ORDER BY
      CASE WHEN r.room_number ~ '^[0-9]+$' THEN 0 ELSE 1 END,
      CASE WHEN r.room_number ~ '^[0-9]+$' THEN r.room_number::NUMERIC ELSE 0 END,
      r.room_number), '[]'::JSONB)
    INTO v_targets
    FROM public.rooms r
    WHERE r.property_id = p_property_id AND (v_all OR r.id = ANY (p_ids));
  ELSIF p_kind = 'department' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', d.id, 'kind', 'department', 'label', d.name, 'sublabel', 'Team tip'
    ) ORDER BY d.name), '[]'::JSONB)
    INTO v_targets
    FROM public.departments d
    WHERE d.property_id = p_property_id AND (v_all OR d.id = ANY (p_ids));
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', pe.id, 'kind', 'person', 'label', pe.name, 'sublabel', d.name
    ) ORDER BY pe.name), '[]'::JSONB)
    INTO v_targets
    FROM public.people pe
    JOIN public.departments d ON d.property_id = pe.property_id AND d.id = pe.department_id
    WHERE pe.property_id = p_property_id
      AND pe.role = 'staff'
      AND pe.status = 'active'
      AND (v_all OR pe.id = ANY (p_ids));
  END IF;

  RETURN jsonb_build_object(
    'propertyName', v_prop.name,
    'templateEnabled', COALESCE(v_template_enabled, false),
    'templatePath', CASE WHEN COALESCE(v_template_enabled, false) THEN v_prop.template_path ELSE NULL END,
    'qrPosition', v_prop.qr_position,
    'targets', v_targets
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_qr_targets(UUID, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_qr_targets(UUID, TEXT, UUID[]) TO authenticated;
