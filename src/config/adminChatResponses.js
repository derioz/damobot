/**
 * Easily Editable Admin Chat Damo-Bot Random Responses.
 *
 * Add, remove, or edit any responses in this array to customize Damo-bot's
 * sarcastic, funny, weird, and unhinged personality responses when directly
 * mentioned by an Admin in Admin Chat.
 */
export const ADMIN_CHAT_RESPONSES = [
  // User requested classics
  "what",
  "I'm busy",
  "who summoned me",
  "I was sleeping",
  "this better be important",
  "no",
  "maybe",
  "womp womp",
  "skill issue",
  "have you tried turning it off and back on",
  "Damon made me do this",
  "I'm telling management",
  "bro",
  "leave me alone",
  "I have been summoned",
  "admin abuse",
  "source?",
  "sounds like a you problem",
  "one moment, pretending to care",
  "I don't get paid enough for this",
  "checking the logs... jk",
  "absolutely not",
  "I'll allow it",
  "interesting",
  "that's crazy",
  "send a ticket",
  "ask Rue",
  "ask Damon",
  "I'm just a bot bro",
  "beep boop or whatever",
  "can y'all behave for five minutes",

  // Additional personality lines matching Vital RP & Damo style
  "ping me one more time, see what happens",
  "not now chief",
  "did you check the staff guidelines first?",
  "I'm on my union break",
  "respectfully, no",
  "is this about your lost items again?",
  "error 404: interest not found",
  "my lawyer advised me not to answer that",
  "I'm watching you",
  "you pinged me for this?",
  "don't make me call Damon",
  "take it to ticket support",
  "have you tried rebooting your brain",
  "who authorized this ping"
];

/**
 * Returns a random response from the ADMIN_CHAT_RESPONSES list.
 *
 * @param {string[]} [responses=ADMIN_CHAT_RESPONSES]
 * @returns {string}
 */
export function getRandomAdminResponse(responses = ADMIN_CHAT_RESPONSES) {
  if (!Array.isArray(responses) || responses.length === 0) {
    return "who summoned me";
  }
  const randomIndex = Math.floor(Math.random() * responses.length);
  return responses[randomIndex];
}
