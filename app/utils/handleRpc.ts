import { supabase } from '@/libs/supabase'

/**
 * Thin wrappers around the two handle RPCs added in
 * supabase/migrations/0011_unique_handles.sql. Both are plain passthroughs --
 * the interesting behaviour (validation, reservation, the taken/malformed/
 * signed-out raises) lives entirely in the SQL, and duplicating any of it
 * here would just be a second copy to keep in sync.
 */

/**
 * Advisory only. The unique index and handle_reservations primary key are
 * the actual enforcement -- any check-then-act is a race, so this exists
 * purely to colour the field in EditProfileOverlay while the user types, not
 * to decide whether set_handle below will succeed.
 */
export async function checkHandleAvailable(handle: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('handle_available', { p_handle: handle })
  if (error) throw error
  return Boolean(data)
}

/**
 * Validates, reserves, releases the previous reservation and updates the
 * profile in one transaction server-side. Returns the handle on success.
 *
 * Raises rather than fails quietly: 23505 when the handle is taken (the
 * expected outcome of two people racing for it, not a crash), 22023 when it
 * is malformed, 28000 when the caller has no session. The caller of this
 * function is expected to catch and render error.message as-is -- the SQL
 * already wrote the user-facing copy for each case, so re-deriving it here
 * from error.code would just be a second copy that can drift from the
 * server's.
 */
export async function setHandle(handle: string): Promise<string> {
  const { data, error } = await supabase.rpc('set_handle', { p_handle: handle })
  if (error) throw error
  return data as string
}
