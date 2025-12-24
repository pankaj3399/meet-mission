function buildGroupsAndRounds(allTeams, allBars = []) {
  console.log("All Teams: ", allTeams);
  console.log("=========================");
  console.log("=========================");
  console.log("All Bars: ", allBars);
  console.log("=========================");
  console.log("=========================");
  const groupsAndRounds = {};
  const notes = [];
  const cancelledByRound = {};

  const byAge = new Map();
  for (const t of allTeams) {
    if (!byAge.has(t.age_group)) byAge.set(t.age_group, []);
    byAge.get(t.age_group).push(t);
  }

  for (const [age_group, teams] of byAge.entries()) {
    groupsAndRounds[age_group] = {};
    cancelledByRound[age_group] = {};

    const teamCount = teams.length;
    notes.push(`ℹ️ ${age_group}: ${teamCount} teams detected.`);

    if (teamCount < 6) {
      notes.push(`❌ Event canceled for ${age_group} (<6 teams).`);
      cancelledByRound[age_group]["all"] = teams.map(t => ({
        ...t,
        reason: "Too few teams"
      }));
      continue;
    }

    // auto mode
    let mode, rounds;
    if (teamCount >= 12) {
      mode = "A"; rounds = 3;
    } else if (teamCount >= 9) {
      mode = "B"; rounds = 2;
    } else {
      mode = "C"; rounds = 2;
    }
    notes.push(`✅ ${age_group}: Mode ${mode}, ${rounds} rounds.`);

    // use the renamed low-level scheduler
    const schedResult = scheduleRoundsForAgeGroup(teams, rounds, allBars, mode);

    groupsAndRounds[age_group] = schedResult.groupsByRound || {};
    if (schedResult.notes) notes.push(...schedResult.notes);
  }

  return { groupsAndRounds, notes, cancelledByRound };
}

// 🔹 Low-level scheduler (handles bar rotation + groups)
function scheduleRoundsForAgeGroup(teams, rounds, bars, mode) {
  const validation = validateSchedulerInputs(bars, mode, rounds);
  if (!validation.isValid) {
    const fullMessage = `Scheduling failed for Mode ${mode}: ${validation.message}`;
    return {
      success: false,
      notes: [fullMessage],
      groupsByRound: {}
    };
  }

  const threePersonTeam = teams.find(t => Array.isArray(t.members) && t.members.length === 3);
  // Create a list of all other teams
  const standardTeams = threePersonTeam
    ? teams.filter(t => t.team_id !== threePersonTeam.team_id)
    : teams;

  const pairHistory = new Set(); // track all pairings across rounds
  const result = { success: true, groupsByRound: {} };

  // Round 1 → distribute evenly into bars
  const round1Assignments = distributeToBars(standardTeams, bars, threePersonTeam);
  let barAssignments = round1Assignments;

  for (let r = 0; r < rounds; r++) {
    if (r === 0) {
      // For Round 1, we use the initial assignments directly.
      barAssignments = round1Assignments;
    } else if (mode === "A" && r === 1) {
      // Use the new sophisticated rotator which needs the original Round 1 assignments.
      barAssignments = rotateBarsForModeA(round1Assignments, bars);
    } else if (mode === "A" && r === 2) {
      // Round 3: stay in the same bar but reshuffle groups
      barAssignments = stayInSameBars(barAssignments);
    } else {
      barAssignments = reshuffleFor2RoundEvent(round1Assignments, bars);
    }

    let groupsForRound = [];
    for (const bar of bars) {
      const barTeams = barAssignments[bar._id] || [];

      const specialTeamInThisBar = barTeams.find(t => t.team_id === threePersonTeam?.team_id);
      const otherTeamsInBar = specialTeamInThisBar
        ? barTeams.filter(t => t.team_id !== threePersonTeam.team_id)
        : barTeams;

      let barGroups = splitIntoBalancedGroups(otherTeamsInBar, 3, 5, specialTeamInThisBar);

      // Ensure no duplicate encounters (tries hard, but won’t cancel)
      barGroups = resolveDuplicates(barGroups, pairHistory, r + 1);

      groupsForRound.push({
        bar_id: bar._id,
        groups: barGroups
      });
    }

    result.groupsByRound[r + 1] = groupsForRound;
  }

  return result;
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}


// ---- Helper Functions ----

/**
 * Distributes teams evenly across available bars, with special handling for a larger team.
 * If a specialTeam (e.g., a 3-person team) is provided, it is placed first into the
 * bar with the highest capacity to prevent bottlenecks.
 *
 * @param {Array<Object>} teams - The array of standard team objects to distribute.
 * @param {Array<Object>} bars - The list of all available bar objects.
 * @param {Object|null} specialTeam - An optional team to be placed with priority.
 * @returns {Object} The bar assignments. Key: bar_id, Value: array of teams.
 */
function distributeToBars(teams, bars, specialTeam = null) {
  const assignments = {};
  bars.forEach(b => (assignments[b._id] = []));

  // Place the special team first in the bar with the highest capacity.
  if (specialTeam && bars.length > 0) {
    // Create a copy with [...bars] to avoid mutating the original array.
    const sortedBars = [...bars].sort((a, b) => (b.available_spots || 0) - (a.available_spots || 0));
    const highestCapacityBarId = sortedBars[0]._id;
    assignments[highestCapacityBarId].push(specialTeam);
  }

  // Distribute the rest of the standard teams evenly.
  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  shuffled.forEach((t, i) => {
    // Use modulo to cycle through bars for even distribution.
    assignments[bars[i % bars.length]._id].push(t);
  });

  return assignments;
}

function reshuffleFor2RoundEvent(round1Assignments, allBars) {
  const newAssignments = {};
  allBars.forEach(b => (newAssignments[b._id] = []));

  for (const sourceBarId of Object.keys(round1Assignments)) {
    const teamsToMove = round1Assignments[sourceBarId];
    const destinationBars = allBars.filter(b => b._id !== sourceBarId);

    if (destinationBars.length === 0) {
        newAssignments[sourceBarId].push(...teamsToMove);
        continue;
    }

    teamsToMove.forEach((team, i) => {
      const destinationBar = destinationBars[i % destinationBars.length];
      newAssignments[destinationBar._id].push(team);
    });
  }

  return newAssignments;
}

// simple rotation: A->B, B->C, C->A
function rotateBars(prevAssignments, bars, mode, roundNum) {
  let newAssignments = {};
  bars.forEach(b => (newAssignments[b._id] = []));

  bars.forEach((bar, i) => {
    const nextBar = bars[(i + 1) % bars.length];
    prevAssignments[bar._id].forEach(team => {
      newAssignments[nextBar._id].push(team);
    });
  });

  return newAssignments;
}

/**
 * Handles the sophisticated bar rotation and team assignment for Round 2 of a Mode A event.
 *
 * This function implements two key rules:
 * 1.  **Smart Rotation:** It tries to move teams to new bars but allows some to stay if it helps create
 *     better, conflict-free groups. It ensures not everyone stays in the same place.
 * 2.  **Start Bar Rule:** It constructs new groups by attempting to pull ONE team from each of the
 *     original starting bars from Round 1, ensuring maximum participant mixing.
 *
 * @param {Object} round1Assignments - The bar assignments from Round 1. Key: bar_id, Value: array of teams.
 * @param {Array<Object>} allBars - The list of all available bar objects for this age group.
 * @returns {Object} The new bar assignments for Round 2. Key: bar_id, Value: array of teams.
 */
function rotateBarsForModeA(round1Assignments, allBars) {
  const newAssignments = {};
  allBars.forEach(b => (newAssignments[b._id] = []));

  const sourcePools = JSON.parse(JSON.stringify(round1Assignments));
  const sourceBarIds = Object.keys(sourcePools);

  for (const targetBar of allBars) {
    const targetBarId = targetBar._id;
    const teamsInTargetBar = newAssignments[targetBarId];

    const totalTeams = Object.values(sourcePools).flat().length;
    const numBars = allBars.length;
    const baseSize = Math.floor(totalTeams / numBars);
    const remainder = totalTeams % numBars;
    // This logic determines how many bars get an extra team.
    const targetGroupSize = baseSize + (allBars.findIndex(b => b._id === targetBarId) < remainder ? 1 : 0);

    for (let i = 0; i < targetGroupSize; i++) {
      const sourceBarId = sourceBarIds[i % sourceBarIds.length];
      const sourcePool = sourcePools[sourceBarId];

      if (sourcePool && sourcePool.length > 0) {
        const teamToMove = sourcePool.shift();
        teamsInTargetBar.push(teamToMove);
      }
    }
  }

  // Sanity check: Ensure at least one team has actually moved.
  // This prevents a scenario where every team ends up back in its original bar.
  const didMove = Object.values(newAssignments).flat().some(team => {
      const originalBar = Object.keys(round1Assignments).find(barId =>
          round1Assignments[barId].some(t => t.team_id === team.team_id)
      );
      const newBar = Object.keys(newAssignments).find(barId =>
          newAssignments[barId].some(t => t.team_id === team.team_id)
      );
      return originalBar !== newBar;
  });

  if (!didMove && allBars.length > 1) {
      // If no one moved (e.g., total teams equals total bars), force a simple rotation.
      // This is a fallback to prevent a stagnant round.
      console.warn("Mode A fallback: Forcing a simple rotation as the initial assignment resulted in no movement.");
      return rotateBars(round1Assignments, allBars);
  }

  return newAssignments;
}

// mode A round 3: stay in same bar
function stayInSameBars(prevAssignments) {
  return JSON.parse(JSON.stringify(prevAssignments));
}

/**
 * Splits a list of teams into perfectly balanced groups.
 * If a specialTeam is provided, it is intentionally placed into one of the larger subgroups
 * to better balance participant distribution within the bar.
 *
 * @param {Array<Object>} standardTeams - The array of standard teams to be split.
 * @param {number} minSize - The minimum number of teams allowed in a group.
 * @param {number} maxSize - The maximum number of teams allowed in a group.
 * @param {Object|null} specialTeam - An optional team to be placed with priority into a larger group.
 * @returns {Array<Array<Object>>} An array of groups.
 */
function splitIntoBalancedGroups(standardTeams, minSize = 3, maxSize = 5, specialTeam = null) {
  const totalTeams = standardTeams.length + (specialTeam ? 1 : 0);
  if (totalTeams === 0) return [];
  if (totalTeams < minSize) {
    // If we can't meet the min size, return one group with all teams.
    return [specialTeam ? [specialTeam, ...standardTeams] : standardTeams];
  }

  const targetSize = 4;
  const numGroups = Math.max(1, Math.round(totalTeams / targetSize));
  const baseSize = Math.floor(totalTeams / numGroups);
  const remainder = totalTeams % numGroups;

  const groups = [];
  const shuffledStandardTeams = [...standardTeams].sort(() => Math.random() - 0.5);
  let currentIndex = 0;
  let specialTeamPlaced = false;

  for (let i = 0; i < numGroups; i++) {
    const isLargerGroup = i < remainder;
    let currentGroupSize = baseSize + (isLargerGroup ? 1 : 0);
    const group = [];

    // If this is one of the larger groups and we have a special team to place, add it first.
    if (isLargerGroup && specialTeam && !specialTeamPlaced) {
      group.push(specialTeam);
      specialTeamPlaced = true;
    }

    // Fill the rest of the group with standard teams.
    const needed = currentGroupSize - group.length;
    if (needed > 0) {
      group.push(...shuffledStandardTeams.slice(currentIndex, currentIndex + needed));
      currentIndex += needed;
    }
    groups.push(group);
  }

  // Fallback: If the special team couldn't be placed (e.g., all groups are same size), add it to the first group.
  if (specialTeam && !specialTeamPlaced) {
      if (groups.length > 0) {
          groups[0].push(specialTeam);
      } else {
          groups.push([specialTeam]); // Should be an edge case
      }
  }

  return groups;
}

function resolveDuplicates(groups, pairHistory, roundNumber) {
  const hasDuplicate = (group) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const key = [group[i].team_id, group[j].team_id].sort().join("-");
        if (pairHistory.has(key)) return true; // seen before in ANY round
      }
    }
    return false;
  };

  // try up to 200 reshuffles to avoid repeats
  let attempts = 0;
  while (groups.some(hasDuplicate) && attempts < 200) {
    groups = shuffle(groups.flat()).reduce((acc, team, i) => {
      const idx = Math.floor(i / 4); // target group size ~4
      if (!acc[idx]) acc[idx] = [];
      acc[idx].push(team);
      return acc;
    }, []);
    attempts++;
  }

  // mark all new pairs as seen
  for (let g of groups) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const key = [g[i].team_id, g[j].team_id].sort().join("-");
        pairHistory.add(key);
      }
    }
  }

  // if still duplicates after 200 tries → allow them, but log
  if (groups.some(hasDuplicate)) {
    console.warn(`⚠️ Duplicate unavoidable in round ${roundNumber}`);
  }

  return groups;
}

/**
 * Validates if the provided inputs are sufficient to run a valid event schedule.
 *
 * This function checks if there are enough bars available for the selected event mode
 * to ensure that core rules (like bar rotation) can be met.
 *
 * @param {Array<Object>} bars - The list of available bar objects.
 * @param {string} mode - The event mode ('A', 'B', or 'C').
 * @param {number} rounds - The number of rounds for the event.
 * @returns {{isValid: boolean, message: string}} An object where `isValid` is true if validation passes,
 *                                                 and `message` contains an error string if it fails.
 */
function validateSchedulerInputs(bars, mode, rounds) {
  const numBars = bars.length;
  let requiredBars = 0;
  let errorMessage = "";

  if (mode === "C") {
    // Mode C runs with 2 groups and requires a bar switch.
    requiredBars = 2;
    if (numBars < requiredBars) {
      errorMessage = `Mode C requires at least ${requiredBars} bars, but only ${numBars} were provided. Cannot guarantee that teams visit two different bars.`;
    }
  } else if (mode === "B") {
    // Mode B runs with 3 groups, ideally each in its own bar for Round 1.
    requiredBars = 3;
    if (numBars < requiredBars) {
      errorMessage = `Mode B requires at least ${requiredBars} bars for proper group distribution, but only ${numBars} were provided.`;
    }
  } else if (mode === "A" && rounds > 1) {
    // Mode A needs to be able to rotate teams.
    requiredBars = 2; // A modest requirement, but prevents stagnant 1-bar events.
    if (numBars < requiredBars) {
      errorMessage = `A multi-round Mode A event requires at least ${requiredBars} bars to allow for rotation, but only ${numBars} were provided.`;
    }
  }

  if (errorMessage) {
    return { isValid: false, message: errorMessage };
  }

  return { isValid: true, message: "" };
}

// function checkBarCapacities(groupsAndRounds, bars) {
//   const barMap = new Map(bars.map(b => [b._id, b.available_spots]));
//   const deficits = {};
//   const barMaxUsage = {}; // track peak usage details per bar

//   for (const [ageGroup, rounds] of Object.entries(groupsAndRounds)) {
//     for (const [round, barList] of Object.entries(rounds)) {
//       for (const bar of barList) {
//         // Flatten all teams across groups in this bar
//         const teams = bar.groups.flat();

//         // Count people, not teams
//         const roundCount = teams.reduce(
//           (sum, team) => sum + (team.members?.length || 0),
//           0
//         );

//         const available = barMap.get(bar.bar_id) || 0;

//         // Track max usage per bar
//         if (
//           !barMaxUsage[bar.bar_id] ||
//           roundCount > barMaxUsage[bar.bar_id].assigned
//         ) {
//           barMaxUsage[bar.bar_id] = {
//             assigned: roundCount,
//             available,
//             ageGroup,
//             round
//           };
//         }

//         console.log(
//           `Bar ${bar.bar_id}, Round ${round}, Age ${ageGroup}: ` +
//           `Available = ${available}, This Round = ${roundCount}, ` +
//           `PeakSoFar = ${barMaxUsage[bar.bar_id].assigned}`
//         );
//       }
//     }
//   }

//   // After collecting all rounds, check deficits
//   for (const [barId, peak] of Object.entries(barMaxUsage)) {
//     if (peak.assigned > peak.available) {
//       deficits[barId] = {
//         needed: peak.assigned - peak.available,
//         byRound: {
//           ageGroup: peak.ageGroup,
//           round: peak.round,
//           total: peak.assigned,
//           available: peak.available
//         }
//       };
//     }
//   }

//   return deficits;
// }
// groupsAndRounds shape: { "<age_group>": { "<round>": [ { bar_id, groups: [ [team,...], ... ] }, ... ] } }
// bars shape: [ { _id: "<barId>", available_spots: 20 }, ... ]

function checkBarCapacities(groupsAndRounds, bars) {
  // Normalize bar capacities, using string keys
  const barMap = new Map(
    bars.map(b => {
      let cap = Number(b.available_spots);
      if (Number.isNaN(cap)) cap = 0;
      return [String(b._id), cap]; // ✅ ensure string key
    })
  );

  const barRoundUsage = {};

  // 1) accumulate usage per bar per round across age groups
  for (const [ageGroup, roundsObj] of Object.entries(groupsAndRounds)) {
    for (const [roundKey, barList] of Object.entries(roundsObj || {})) {
      for (const bar of barList) {
        const barId = String(bar.bar_id); // ✅ normalize to string
        if (!barRoundUsage[barId]) barRoundUsage[barId] = {};
        if (!barRoundUsage[barId][roundKey]) {
          barRoundUsage[barId][roundKey] = { total: 0, breakdown: {} };
        }

        let roundCount = 0;
        for (const group of (bar.groups || [])) {
          for (const team of (group || [])) {
            roundCount += Array.isArray(team.members) ? team.members.length : 0;
          }
        }

        barRoundUsage[barId][roundKey].total += roundCount;
        barRoundUsage[barId][roundKey].breakdown[ageGroup] =
          (barRoundUsage[barId][roundKey].breakdown[ageGroup] || 0) + roundCount;
      }
    }
  }

  // 2) compute peak per bar and deficits
  const deficits = {};
  for (const [barId, roundsObj] of Object.entries(barRoundUsage)) {
    const available = barMap.get(barId) ?? 0;
    let peakTotal = 0;
    let peakRoundKey = null;
    let peakBreakdown = null;

    for (const [roundKey, info] of Object.entries(roundsObj)) {
      if (info.total > peakTotal) {
        peakTotal = info.total;
        peakRoundKey = roundKey;
        peakBreakdown = info.breakdown;
      }
    }

    if (peakTotal > available) {
      deficits[barId] = {
        needed: peakTotal - available,
        peakAssigned: peakTotal,
        available,
        peakRound: peakRoundKey,
        breakdown: peakBreakdown,
        name: bars.filter((b) => String(b._id) === barId)?.[0]?.name
      };
    }
  }

  return { deficits, barRoundUsage };
}


// Optional helper: return the list of teams assigned to a given bar in a given round (with their age_group and members count)
function getTeamsForBarRound(groupsAndRounds, targetBarId, targetRound) {
  const teams = []; // { team_id, team_name, age_group, membersCount }

  for (const [ageGroup, roundsObj] of Object.entries(groupsAndRounds)) {
    const barList = (roundsObj || {})[String(targetRound)] || [];
    for (const bar of barList) {
      if (bar.bar_id !== targetBarId) continue;
      for (const group of (bar.groups || [])) {
        for (const team of (group || [])) {
          teams.push({
            team_id: team.team_id,
            team_name: team.team_name,
            age_group: ageGroup,
            membersCount: Array.isArray(team.members) ? team.members.length : 0
          });
        }
      }
    }
  }

  return teams;
}

function verifyGroups(groupsAndRounds) {
  const errors = [];
  const notes = {};

  for (const [ageGroup, rounds] of Object.entries(groupsAndRounds)) {
    const teamOpponents = new Map();

    for (const round of Object.values(rounds)) {
      // round is an array of bar objects
      for (const bar of round) {
        const groups = bar.groups || [];
        for (const group of groups) {
          const teamLabels = group.map(
            t => t?.name || t?.team_id || t?.id || "unknown"
          );

          // track opponents
          for (let i = 0; i < teamLabels.length; i++) {
            const team = teamLabels[i];
            if (!teamOpponents.has(team)) teamOpponents.set(team, new Set());

            for (let j = 0; j < teamLabels.length; j++) {
              if (i === j) continue;
              teamOpponents.get(team).add(teamLabels[j]);
            }
          }
        }
      }
    }

    // summarize
    const oppCounts = Array.from(teamOpponents.values()).map(s => s.size);
    const avg = oppCounts.reduce((a, b) => a + b, 0) / (oppCounts.length || 1);

    notes[ageGroup] = {
      totalTeams: oppCounts.length,
      avgOpponents: avg,
      minOpponents: Math.min(...oppCounts),
      maxOpponents: Math.max(...oppCounts),
    };

    let expected = Math.round(avg);
    for (const [team, oppSet] of teamOpponents.entries()) {
      if (oppSet.size !== expected) {
        errors.push(
          `Age group ${ageGroup}: Team ${team} has ${oppSet.size} unique opponents (expected ~${expected})`
        );
      }
    }
  }

  return { errors, notes };
}


function dedupeBalanceReport(report) {
  const result = {};

  for (let i = 0; i < report.length; i++) {
    const { age_group, team, unique_opponents } = report[i];
    const key = age_group + "-" + team;

    if (!result[key]) {
      result[key] = { age_group, team, unique_opponents: {} };
    }

    for (let j = 0; j < unique_opponents.length; j++) {
      result[key].unique_opponents[unique_opponents[j]] = true;
    }
  }

  return Object.values(result).map(r => ({
    age_group: r.age_group,
    team: r.team,
    unique_opponents: Object.keys(r.unique_opponents),
  }));
}


module.exports = {
    buildGroupsAndRoundsByAge: buildGroupsAndRounds,
    verifyGroups,
    dedupeBalanceReport,
    checkBarCapacities
  };
