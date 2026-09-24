/**
 * First-message suggestions built from what the other modules already know:
 * the app idea, saved personas and journeys. This is where MOSAI starts ahead
 * of a blank prompt box: the first request is already about real customers.
 */
export function starterSuggestions(input: {
  idea?: string;
  personas: Array<{ name: string; role?: string; goals?: string[] }>;
  journeys: Array<{ name: string; stages: Array<{ stage: string }> }>;
}): string[] {
  const idea = input.idea?.trim();
  const persona = input.personas[0];
  const journey = input.journeys[0];
  const suggestions: string[] = [];
  if (idea) {
    suggestions.push(
      persona
        ? `Build the first version: ${idea}. Design it for ${persona.name}${persona.role ? ` (${persona.role})` : ""}${persona.goals?.[0] ? `, who wants to ${persona.goals[0].replace(/^to\s+/i, "")}` : ""}.`
        : `Build the first version: ${idea}.`,
    );
  }
  if (journey && journey.stages.length > 1) {
    suggestions.push(
      `Create one screen for each step of the "${journey.name}" journey: ${journey.stages.slice(0, 5).map((stage) => stage.stage).join(", ")}.`,
    );
  }
  if (persona) {
    suggestions.push(`Add a simple dashboard that shows ${persona.name} what needs their attention today.`);
  }
  if (suggestions.length === 0) {
    suggestions.push("Build a booking app where customers pick a service, choose a time and leave their details.");
  }
  return suggestions.slice(0, 3);
}
