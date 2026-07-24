/**
 * Hand-written types for the SetOS Postgres schema (see db/migrations/*.sql).
 * Kept minimal and matched to what the service layer touches. If the live schema
 * drifts, `npx supabase gen types typescript` can regenerate a fuller version.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface MealLogRow {
  id: string;
  user_id: string;
  logged_at: string;
  source_type: string;
  raw_text: string | null;
  transcript_text: string | null;
  image_url: string | null;
  parsed_meal_name: string;
  estimated_calories: number;
  estimated_protein_g: number;
  estimated_carbs_g: number;
  estimated_fat_g: number;
  estimated_fiber_g: number;
  confidence: string;
  assumptions_json: Json;
  created_at: string;
  updated_at: string;
}

export interface DailyTotalsRow {
  id: string;
  user_id: string;
  date: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  updated_at: string;
}

export interface WorkoutSessionRow {
  id: string;
  user_id: string;
  date: string;
  title: string | null;
  notes: string | null;
  created_at: string;
}

export interface WorkoutExerciseRow {
  id: string;
  workout_session_id: string;
  exercise_name: string;
  normalized_exercise_name: string;
  sort_order: number;
  created_at: string;
}

export interface WorkoutSetRow {
  id: string;
  workout_exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  unit: string | null;
  duration_seconds: number | null;
  distance: string | null;
  rir: number | null;
  notes: string | null;
  created_at: string;
}

export interface BodyMetricRow {
  id: string;
  user_id: string;
  date: string;
  body_weight: number | null;
  notes: string | null;
  created_at: string;
}
