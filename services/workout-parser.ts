import type { ParsedExercise, ParsedSet } from "@/validators/workout";

// Weight alias resolution
const PLATE_WEIGHT = 45; // lb per side, 45lb bar
function resolveWeight(input: string): number | null {
  const s = input.toLowerCase().trim();

  // "2 plates" = 225, "3 plates" = 315, etc.
  const platesMatch = s.match(/^(\d+)\s*plates?$/);
  if (platesMatch) {
    return PLATE_WEIGHT + parseInt(platesMatch[1]) * PLATE_WEIGHT * 2;
  }

  // "plate and 25" = 185, "plate and 35" = 205
  const plateAndMatch = s.match(/^(?:a\s+)?plate\s+and\s+(\d+)$/);
  if (plateAndMatch) {
    return PLATE_WEIGHT + (PLATE_WEIGHT + parseInt(plateAndMatch[1])) * 2;
  }

  // "plate" = 135
  if (s === "plate" || s === "a plate") {
    return PLATE_WEIGHT + PLATE_WEIGHT * 2;
  }

  // "60s" = 60 (dumbbell shorthand)
  const dbMatch = s.match(/^(\d+)s$/);
  if (dbMatch) return parseInt(dbMatch[1]);

  // plain number
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

// Exercise name normalization
const EXERCISE_ALIASES: Record<string, string> = {
  bench: "Bench Press",
  "flat bench": "Bench Press",
  "bench press": "Bench Press",
  "incline bench": "Incline Bench Press",
  "incline db": "Incline DB Press",
  "incline dumbbell": "Incline DB Press",
  "incline db press": "Incline DB Press",
  squat: "Squat",
  squats: "Squat",
  "back squat": "Back Squat",
  "front squat": "Front Squat",
  deadlift: "Deadlift",
  dl: "Deadlift",
  ohp: "Overhead Press",
  "overhead press": "Overhead Press",
  "military press": "Overhead Press",
  row: "Barbell Row",
  "barbell row": "Barbell Row",
  "bent over row": "Barbell Row",
  "db row": "DB Row",
  "dumbbell row": "DB Row",
  "lat pulldown": "Lat Pulldown",
  "lat pull": "Lat Pulldown",
  pullup: "Pull-up",
  "pull up": "Pull-up",
  pullups: "Pull-up",
  "chin up": "Chin-up",
  chinup: "Chin-up",
  dip: "Dip",
  dips: "Dip",
  curl: "Bicep Curl",
  curls: "Bicep Curl",
  "bicep curl": "Bicep Curl",
  "hammer curl": "Hammer Curl",
  "tricep pushdown": "Tricep Pushdown",
  "skull crusher": "Skull Crusher",
  "skull crushers": "Skull Crusher",
  "leg press": "Leg Press",
  "leg curl": "Leg Curl",
  "leg extension": "Leg Extension",
  "calf raise": "Calf Raise",
  "calf raises": "Calf Raise",
  "lateral raise": "Lateral Raise",
  "lat raise": "Lateral Raise",
  "face pull": "Face Pull",
  "face pulls": "Face Pull",
  "cable fly": "Cable Fly",
  "cable flies": "Cable Fly",
  run: "Run",
  running: "Run",
  jog: "Run",
  walk: "Walk",
  walking: "Walk",
  bike: "Bike",
  cycling: "Bike",
  "stair master": "Stair Master",
  stairmaster: "Stair Master",
  elliptical: "Elliptical",
};

export function normalizeExerciseName(name: string): string {
  const key = name.toLowerCase().trim();
  return EXERCISE_ALIASES[key] || name.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

const CARDIO_EXERCISES = new Set([
  "Run",
  "Walk",
  "Bike",
  "Stair Master",
  "Elliptical",
]);

// Parse formats like: "185x8", "3x10", "4x8@185"
function parseSetsxReps(input: string): { sets: ParsedSet[]; weight: number | null } | null {
  // WEIGHTxREPS (e.g., 185x8)
  const wxr = input.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+)$/i);
  if (wxr) {
    const a = parseFloat(wxr[1]);
    const b = parseInt(wxr[2]);
    // Heuristic: if a > 20, it's weight x reps. If a <= 20, it's sets x reps.
    if (a > 20) {
      return {
        sets: [{ reps: b, weight: a, unit: "lb" }],
        weight: a,
      };
    } else {
      return {
        sets: Array.from({ length: a }, () => ({
          reps: b,
          weight: null,
          unit: "lb" as const,
        })),
        weight: null,
      };
    }
  }

  // SETSxREPS@WEIGHT (e.g., 4x10@140)
  const sxrw = input.match(/^(\d+)\s*x\s*(\d+)\s*@\s*(.+)$/i);
  if (sxrw) {
    const numSets = parseInt(sxrw[1]);
    const reps = parseInt(sxrw[2]);
    const weight = resolveWeight(sxrw[3]);
    return {
      sets: Array.from({ length: numSets }, () => ({
        reps,
        weight,
        unit: "lb" as const,
      })),
      weight,
    };
  }

  return null;
}

// Parse cardio: "run 25 min easy", "ran 30 minutes"
function parseCardio(input: string): ParsedExercise | null {
  const cardioMatch = input.match(
    /^(ran|run|walk|walked|bike|biked|cycling|elliptical|stairmaster|stair\s*master)\s+(\d+)\s*(min|mins|minutes|hr|hrs|hours?)(?:\s+(.+))?$/i
  );
  if (!cardioMatch) return null;

  const exerciseRaw = cardioMatch[1];
  const duration = parseInt(cardioMatch[2]);
  const unit = cardioMatch[3].toLowerCase();
  const notes = cardioMatch[4] || null;

  const seconds = unit.startsWith("hr") || unit.startsWith("hour")
    ? duration * 3600
    : duration * 60;

  const name = normalizeExerciseName(exerciseRaw);
  return {
    exercise_name: name,
    normalized_exercise_name: name,
    sets: [
      {
        reps: null,
        weight: null,
        unit: "lb",
        duration_seconds: seconds,
        distance: null,
        notes,
      },
    ],
    is_cardio: true,
  };
}

// Parse "exercise_name weight reps reps reps" or "exercise_name WEIGHTxREPS"
export function parseWorkoutMessage(
  input: string,
  currentExercise?: string | null
): ParsedExercise[] | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try cardio first
  const cardio = parseCardio(trimmed);
  if (cardio) return [cardio];

  // Try to extract exercise name from beginning
  let exerciseName: string | null = null;
  let remainder = trimmed;

  // Check if input starts with a known exercise name
  const words = trimmed.toLowerCase().split(/\s+/);
  for (let len = Math.min(words.length - 1, 4); len >= 1; len--) {
    const candidate = words.slice(0, len).join(" ");
    if (EXERCISE_ALIASES[candidate]) {
      exerciseName = EXERCISE_ALIASES[candidate];
      remainder = trimmed.slice(candidate.length).trim();
      break;
    }
  }

  // If no exercise found but we have currentExercise context, use it
  if (!exerciseName && currentExercise) {
    exerciseName = currentExercise;
  }

  // If still no exercise name and remainder looks like just numbers, we need context
  if (!exerciseName) {
    // Check if the whole input could be an exercise + sets
    // e.g., "bench 185x8" — already handled above
    // If it's just numbers like "185x8" or "10 10 8", we need context
    const hasNumbers = /\d/.test(remainder);
    if (hasNumbers && remainder === trimmed) {
      // No exercise name extracted, entire input is the remainder
      // Try to parse as pure sets — will need currentExercise from caller
      if (!currentExercise) return null;
      exerciseName = currentExercise;
    }
  }

  if (!exerciseName) return null;

  const normalizedName = normalizeExerciseName(exerciseName);
  const isCardi = CARDIO_EXERCISES.has(normalizedName);

  // Parse the remainder as sets
  const sets: ParsedSet[] = [];

  // Try SETSxREPS or WEIGHTxREPS patterns
  const sxr = parseSetsxReps(remainder);
  if (sxr) {
    return [
      {
        exercise_name: exerciseName,
        normalized_exercise_name: normalizedName,
        sets: sxr.sets,
        is_cardio: isCardi,
      },
    ];
  }

  // Try "WEIGHT REPS REPS REPS" pattern (e.g., "60s 10 10 8")
  const parts = remainder.split(/\s+/);
  if (parts.length >= 2) {
    const weight = resolveWeight(parts[0]);
    if (weight !== null) {
      const repsNumbers = parts.slice(1).filter((p) => /^\d+$/.test(p));
      if (repsNumbers.length > 0) {
        for (const r of repsNumbers) {
          sets.push({
            reps: parseInt(r),
            weight,
            unit: "lb",
          });
        }
        return [
          {
            exercise_name: exerciseName,
            normalized_exercise_name: normalizedName,
            sets,
            is_cardio: isCardi,
          },
        ];
      }
    }

    // "SETSxREPS @ WEIGHT" or "SETSxREPS at WEIGHT" spread across parts
    // e.g., "4x10 @ 140" was already handled by parseSetsxReps on joined remainder
    // Try joining with no spaces
    const joined = parts.join("");
    const sxr2 = parseSetsxReps(joined);
    if (sxr2) {
      return [
        {
          exercise_name: exerciseName,
          normalized_exercise_name: normalizedName,
          sets: sxr2.sets,
          is_cardio: isCardi,
        },
      ];
    }
  }

  // Try "REPS REPS REPS" pattern (just rep counts, no weight)
  const allNumbers = parts.every((p) => /^\d+$/.test(p));
  if (allNumbers && parts.length >= 1) {
    for (const r of parts) {
      sets.push({ reps: parseInt(r), weight: null, unit: "lb" });
    }
    return [
      {
        exercise_name: exerciseName,
        normalized_exercise_name: normalizedName,
        sets,
        is_cardio: isCardi,
      },
    ];
  }

  // Single number — could be weight or reps
  const singleNum = parseFloat(remainder);
  if (!isNaN(singleNum)) {
    // If > 20, probably a weight with implied 1 rep
    // Otherwise, reps
    if (singleNum > 20) {
      sets.push({ reps: 1, weight: singleNum, unit: "lb" });
    } else {
      sets.push({ reps: singleNum, weight: null, unit: "lb" });
    }
    return [
      {
        exercise_name: exerciseName,
        normalized_exercise_name: normalizedName,
        sets,
        is_cardio: isCardi,
      },
    ];
  }

  return null;
}
