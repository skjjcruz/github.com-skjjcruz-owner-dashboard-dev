// DHQ skills — the methodology, published beside the tools.
//
// Each skill is DHQ's method for one kind of question, written for the
// member's AI to read before it answers: which tool to call, what the
// numbers mean, what decides the call, and what the answer must say.
// They are served as MCP prompts (prompts/list, prompts/get) and also as
// the `method` text inside the matching verdict tool's result, so an AI
// that never reads prompts still sees the method where it matters.
// The rules mirror the app's own code (Lineup screen, team assessor,
// player-action chain, Trade Center partner board, FAAB bid model).
export interface Skill { name: string; title: string; description: string; text: string }

const ANSWER = 'Answer shape: lead with the call in one sentence, then the two or three reasons with their numbers, then the biggest news item on each side and whether it changes the call, then exactly what to do in Sleeper. Never send the member to look something up. Never invent a number a tool did not give you.';

export const SKILLS: Skill[] = [
  {
    name: 'start_sit', title: 'DHQ Start / Sit', description: 'How DHQ decides who starts this week.',
    text: [
      'DHQ START / SIT METHOD (the same rule as the app\'s Lineup screen).',
      '1. Call get_start_sit. Pass the players the member named; it returns THE CALL, the optimal lineup and the swaps. Do not rebuild the lineup yourself.',
      '2. The number is Sleeper\'s weekly projection scored in this league\'s settings (TE premium included). A player Sleeper is not projecting has no number and cannot be started.',
      '3. Out, IR, PUP, suspended and bye players cannot start. Doubtful counts as out. Questionable plays at his projection; say he is questionable and what the latest report says.',
      '4. A player whose game has kicked off is locked where he is and counts his actual points. Never suggest moving a locked player.',
      '5. The solver fills the narrowest slots first (QB, RB, WR, TE, K, DEF, IDP), then receiving flex, then flex, then superflex, always taking the highest projection left. No positional premium.',
      '6. Under half a point apart is a toss-up: say so, then decide on health and news.',
      '7. Then read latest_news and team_news for each player in the call. A new play-caller, a QB change, a teammate injury that frees targets, or a limited practice can move a toss-up; it does not overturn a gap of several points unless the player may not play.',
      '8. Do not use dhq_value or dhq_rate_ppg for this decision. Those are dynasty numbers.',
      ANSWER,
    ].join('\n'),
  },
  {
    name: 'roster_needs', title: 'DHQ Roster Needs', description: 'How DHQ reads a team\'s holes, surplus and window.',
    text: [
      'DHQ ROSTER NEEDS METHOD (the app\'s team assessor).',
      '1. Call get_roster_needs.',
      '2. A quality starter is a player in the league-wide top tier at his position by DHQ value (top N where N is teams for QB/TE/K, 2.5x teams for RB, 4x teams for WR and IDP) or a live NFL starter.',
      '3. Each position: deficit = no quality starter; thin = fewer quality starters than the lineup needs, or too few bodies; surplus = more quality than the lineup needs and full depth; ok otherwise.',
      '4. Tier comes half from health (projected lineup points against the league target plus coverage) and half from standings, ranked inside this league. Window: elite or calm contender = contending; rebuilding = rebuilding; everyone else transitioning.',
      '5. Needs are the deficit and thin spots, worst first. Strengths are surplus spots with spare quality: these are what the member trades from.',
      '6. Tell the member the one or two holes that matter, what to sell to fill them, and whether the window says to pay with picks (contending) or ask for picks (rebuilding).',
      ANSWER,
    ].join('\n'),
  },
  {
    name: 'player_outlook', title: 'DHQ Player Outlook', description: 'How DHQ calls buy, sell or hold on a player.',
    text: [
      'DHQ PLAYER OUTLOOK METHOD (the app\'s player-action chain, first rule that fits wins).',
      'Rookie not yet producing: Stash. Elite (DHQ 7,000+ or top 5 at his position) with 3+ peak years: Build around. 4+ peak years and production up 10%+: Buy (Hold if owned). One peak year left and DHQ 3,000+: Sell high. In the veteran decline band and production down 10%+: Sell high; otherwise Hold. Past the value window: Sell (Hold an IDP depth-chart starter). 2 or fewer peak years and production down 10%+: Sell high. 2+ peak years at DHQ 4,000+: Hold. Under DHQ 2,000 with 3+ peak years: Stash. Not owned, 2+ peak years, under DHQ 5,000: Buy. Otherwise Hold if any peak years remain, else Sell.',
      'Peak years and the decline band are position-specific age curves (RB peaks 23-25, WR 25-28, TE 26-29, QB 28-34). Trend is this season\'s points per game against last season\'s.',
      'The chain does not read injuries, news, the member\'s window or the market. You must: check latest_news and injury, and say whether the member\'s window (from get_roster_needs) agrees. A Sell high on a contender\'s starter can wait until the deadline.',
      ANSWER,
    ].join('\n'),
  },
  {
    name: 'compare_players', title: 'DHQ Compare', description: 'How DHQ compares two or more players.',
    text: [
      'DHQ COMPARE METHOD.',
      '1. Call compare_players. It lists who leads each measure and gives a verdict from two numbers: DHQ value (10%+ gap decides) and runway (2+ more peak years tips a close call).',
      '2. Say which question the member is asking. This week: use get_start_sit. Dynasty value or a trade: use the verdict. Roster fit: check get_roster_needs.',
      ANSWER,
    ].join('\n'),
  },
  {
    name: 'trade_targets', title: 'DHQ Trade Targets', description: 'How DHQ finds who to trade with and for whom.',
    text: [
      'DHQ TRADE TARGETS METHOD (the Trade Center partner board).',
      '1. Call find_trade_targets. Partners are scored on roster fit (their surplus meets your needs and yours meets theirs), mutual need, their panic, their pick capital, how often they trade, their trade DNA, and whether your windows line up (contender with rebuilder is the best match). Locked elite rosters score low.',
      '2. Attack (85+) and Prime (68+) are worth an offer now. Possible (48+) needs the right package. Long shot: do not waste the message.',
      '3. Build the offer from targets_for_you and my_chips or my_picks. Pay rebuilders in picks and young players; pay contenders in starters who score now.',
      '4. Run evaluate_trade on the package before recommending it. A fair grade (B or better) with 50%+ acceptance is a real offer.',
      ANSWER,
    ].join('\n'),
  },
  {
    name: 'trade_evaluation', title: 'DHQ Trade Grade', description: 'How DHQ grades a trade and predicts acceptance.',
    text: [
      'DHQ TRADE METHOD.',
      '1. Call evaluate_trade. Fairness is the value ratio of what you get over what you give: 1.30+ A+ steal, 1.15+ A, 1.05+ B+, 0.95+ B fair, 0.85+ C, 0.75+ D overpay, below F.',
      '2. Acceptance starts at 50% and moves with the surplus you hand them and the psychology taxes: their DNA (fleecers and dominators resist), their panic (a hurting owner deals), whether you fill their need, whether your windows differ, and locked or selling posture. More than four pieces costs acceptance.',
      '3. Add what the grade does not see: injuries and news on each piece, whether it fills the member\'s actual hole (get_roster_needs), and the member\'s window.',
      ANSWER,
    ].join('\n'),
  },
  {
    name: 'waiver_bid', title: 'DHQ Waiver Bid', description: 'How DHQ picks waiver targets and sets a FAAB bid.',
    text: [
      'DHQ WAIVER METHOD.',
      '1. Targets: get_waiver_options for the member\'s need positions (get_roster_needs). Prefer players Sleeper projects this week and who hold a depth-chart spot. A need fill beats a bigger name at a covered position.',
      '2. Bid: get_waiver_bid. It reads this league\'s winning and losing bids, sizes the market by the player\'s strength, models each rival who needs the position and how hard they bid, and returns the smallest bid that wins about 60% of the time, kept under 65% of the remaining budget unless the player is a difference maker.',
      '3. If cold_start is true the league has too few bids on record and the number is a league-agnostic default: say so.',
      ANSWER,
    ].join('\n'),
  },
  {
    name: 'draft_board', title: 'DHQ Draft', description: 'How DHQ reads the league\'s next draft.',
    text: [
      'DHQ DRAFT METHOD.',
      '1. Call get_draft_board for the picks picture and get_pick_values for a slot\'s worth. Pick values follow the industry curve blended with this league\'s own hit rates, discounted 12% per year out.',
      '2. Use this league\'s hit rates by round to say what a pick is really worth here, and its early-round tendencies to predict who goes before the member picks.',
      '3. Prospect rankings are not served yet: say so rather than ranking rookies from memory.',
      ANSWER,
    ].join('\n'),
  },
];

export function skillText(name: string): string | undefined {
  const s = SKILLS.find(x => x.name === name);
  return s ? s.text : undefined;
}
