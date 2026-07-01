const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const rooms = {};

const ROLE_DESCRIPTIONS = {
  Mafia: "You are a silent assassin hiding among the villagers.",
  Doctor: "You are the protector of the village.",
  Villager: "You are an ordinary villager trying to protect your town.",
};

const PHASE_DURATIONS = {
  roleReveal: 3000,
  storyIntro: 12000,
  dayTitle: 2000,
  roomSelection: 15000,
  night: 10000,
  nightResult: 5000,
  votingIntro: 2000,
  voting: 10000,
  voteResult: 5000,
};

const RECONNECT_GRACE_TIME = 60000;

const BLOCKED_NAME_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "bastard",
  "dick",
  "cunt",
  "slut",
  "whore",
  "rape",
  "porn",
  "sex",
];

const FUNNY_DISCONNECT_MESSAGES = [
  "ran away from the village due to fear.",
  "got too stressed and collapsed from panic.",
  "disappeared into the forest and never came back.",
  "locked themselves inside their house and refused to return.",
  "heard one spooky sound and escaped the village.",
  "pretended to be brave, then silently vanished.",
  "left the village after realizing survival is not guaranteed.",
];

function validatePlayerName(playerName) {
  const cleanPlayerName = String(playerName || "").trim();

  if (!cleanPlayerName) {
    return {
      success: false,
      message: "Please enter a valid name.",
    };
  }

  if (cleanPlayerName.length > 10) {
    return {
      success: false,
      message: "Name cannot be more than 10 characters.",
    };
  }

  if (!/^[a-zA-Z0-9]+$/.test(cleanPlayerName)) {
    return {
      success: false,
      message: "Name can contain only letters and numbers. No spaces or symbols.",
    };
  }

  if (/^\d+$/.test(cleanPlayerName)) {
    return {
      success: false,
      message: "Name cannot be only numbers.",
    };
  }

  const lowerName = cleanPlayerName.toLowerCase();

  const hasBlockedWord = BLOCKED_NAME_WORDS.some((word) =>
    lowerName.includes(word)
  );

  if (hasBlockedWord) {
    return {
      success: false,
      message: "Please choose a clean name.",
    };
  }

  return {
    success: true,
    name: cleanPlayerName,
  };
}

function createRoomCode() {
  return "ROOM-" + Math.floor(1000 + Math.random() * 9000);
}

function isChaosMode(room) {
  return room.settings.mode === "Chaos Demo";
}

function getMinimumPlayers(mode) {
  return mode === "Chaos Demo" ? 8 : 6;
}

function getRoleLimits(playerCount) {
  if (playerCount <= 10) {
    return {
      mafiaMin: 1,
      mafiaMax: 1,
      doctorMin: 1,
      doctorMax: 1,
      locked: true,
    };
  }

  if (playerCount <= 15) {
    return {
      mafiaMin: 1,
      mafiaMax: 2,
      doctorMin: 1,
      doctorMax: 2,
      locked: false,
    };
  }

  if (playerCount <= 20) {
    return {
      mafiaMin: 2,
      mafiaMax: 3,
      doctorMin: 1,
      doctorMax: 2,
      locked: false,
    };
  }

  if (playerCount <= 25) {
    return {
      mafiaMin: 3,
      mafiaMax: 4,
      doctorMin: 2,
      doctorMax: 3,
      locked: false,
    };
  }

  return {
    mafiaMin: 4,
    mafiaMax: 5,
    doctorMin: 2,
    doctorMax: 3,
    locked: false,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function normalizeSettings(settings, playerCount) {
  const mode = settings.mode === "Chaos Demo" ? "Chaos Demo" : "Classic Demo";
  const limits = getRoleLimits(playerCount);

  return {
    mode,
    mafiaCount: limits.locked
      ? 1
      : clamp(settings.mafiaCount, limits.mafiaMin, limits.mafiaMax),
    doctorCount: limits.locked
      ? 1
      : clamp(settings.doctorCount, limits.doctorMin, limits.doctorMax),
    discussionTime: Math.max(1, Number(settings.discussionTime) || 2),
  };
}

function getFunnyDisconnectMessage(playerName) {
  const randomMessage =
    FUNNY_DISCONNECT_MESSAGES[
      Math.floor(Math.random() * FUNNY_DISCONNECT_MESSAGES.length)
    ];

  return `${playerName} ${randomMessage}`;
}

function addSystemMessage(room, message) {
  if (!room.systemMessages) {
    room.systemMessages = [];
  }

  room.systemMessages.push({
    id: Date.now() + Math.random(),
    message,
  });

  if (room.systemMessages.length > 8) {
    room.systemMessages = room.systemMessages.slice(-8);
  }
}

function getStatusText(player) {
  if (!player) return "Unknown";
  if (player.gone) return "Gone";
  if (player.disconnected) return "Disconnected";
  if (!player.alive) return "Dead";
  return "Alive";
}

function getViewerPlayer(room, viewerSocketId) {
  if (!viewerSocketId) return null;

  return room.players.find((player) => player.id === viewerSocketId) || null;
}

function namesMatch(nameA, nameB) {
  return String(nameA || "").trim().toLowerCase() ===
    String(nameB || "").trim().toLowerCase();
}

function getDisplayNameForViewer(room, subjectPlayer, viewerPlayer) {
  if (!subjectPlayer) return "Unknown";

  if (!room.gameStarted) {
    return subjectPlayer.name;
  }

  if (!isChaosMode(room) || room.phase === "gameOver") {
    return subjectPlayer.name;
  }

  if (!viewerPlayer) {
    return subjectPlayer.publicName || subjectPlayer.name;
  }

  const subjectPublicName = subjectPlayer.publicName || subjectPlayer.name;

  if (subjectPlayer.playerKey === viewerPlayer.playerKey) {
    return subjectPlayer.name;
  }

  if (namesMatch(subjectPublicName, viewerPlayer.name)) {
    return subjectPlayer.name;
  }

  return subjectPublicName;
}

function getChatDisplayNameForViewer(room, chat, viewerPlayer) {
  if (!isChaosMode(room)) {
    return chat.realPlayerName || chat.playerName;
  }

  if (!viewerPlayer) {
    return chat.publicPlayerName || chat.playerName;
  }

  const realSenderName = chat.realPlayerName || chat.playerName;
  const publicSenderName = chat.publicPlayerName || chat.playerName;

  if (chat.playerKey === viewerPlayer.playerKey || chat.playerId === viewerPlayer.id) {
    return realSenderName;
  }

  if (namesMatch(publicSenderName, viewerPlayer.name)) {
    return realSenderName;
  }

  return publicSenderName;
}

function getRoomEntryNameForViewer(room, entry, viewerPlayer, shouldRevealRoles) {
  if (shouldRevealRoles) {
    return entry.realName;
  }

  if (!isChaosMode(room)) {
    return entry.realName;
  }

  if (!viewerPlayer) {
    return entry.publicName;
  }

  if (namesMatch(entry.realName, viewerPlayer.name)) {
    return entry.realName;
  }

  if (namesMatch(entry.publicName, viewerPlayer.name)) {
    return entry.realName;
  }

  return entry.publicName;
}

function getRoomAllotmentHistory(room, shouldRevealRoles, viewerPlayer) {
  return (room.roomAllotmentHistory || []).map((snapshot) => ({
    day: snapshot.day,
    roomCount: snapshot.roomCount,
    rooms: snapshot.rooms.map((entry) => {
      const player = room.players.find(
        (roomPlayer) => roomPlayer.name === entry.realName
      );

      return {
        roomNumber: entry.roomNumber,
        name: getRoomEntryNameForViewer(
          room,
          entry,
          viewerPlayer,
          shouldRevealRoles
        ),
        publicName: entry.publicName,
        realName: shouldRevealRoles ? entry.realName : undefined,
        role: shouldRevealRoles ? player?.role : undefined,
        status: getStatusText(player),
        alive: player ? player.alive : false,
        gone: player ? player.gone : false,
        disconnected: player ? player.disconnected : false,
      };
    }),
  }));
}

function getPublicRoom(roomCode, viewerSocketId = null) {
  const room = rooms[roomCode];

  if (!room) return null;

  const shouldRevealRoles = room.phase === "gameOver";
  const chaosMode = isChaosMode(room);
  const viewerPlayer = getViewerPlayer(room, viewerSocketId);

  return {
    roomCode,
    hostId: room.hostId,
    players: room.players.map((player) => ({
      id: player.id,
      name: getDisplayNameForViewer(room, player, viewerPlayer),
      realName: shouldRevealRoles ? player.name : undefined,
      publicName: chaosMode ? player.publicName : undefined,
      type: player.type,
      alive: player.alive,
      connected: player.connected,
      disconnected: player.disconnected,
      gone: player.gone,
      reconnectDeadline: player.reconnectDeadline,
      role: shouldRevealRoles ? player.role : undefined,
      roomNumber: player.roomNumber || null,
      selectedRoom: player.selectedRoom || null,
      roomHistory: shouldRevealRoles ? player.roomHistory || [] : undefined,
    })),
    settings: room.settings,
    roleLimits: getRoleLimits(room.players.length),
    gameStarted: room.gameStarted,
    phase: room.phase,
    dayNumber: room.dayNumber,
    phaseEndsAt: room.phaseEndsAt,
    announcement: room.announcement,
    voteResultMessage: room.voteResultMessage,
    winner: room.winner,
    chatMessages: (room.chatMessages || []).map((chat) => ({
      id: chat.id,
      playerId: chat.playerId,
      playerName: getChatDisplayNameForViewer(room, chat, viewerPlayer),
      message: chat.message,
    })),
    lobbyMessages: room.lobbyMessages || [],
    systemMessages: room.systemMessages || [],
    timeControlUsedPlayerIds: Object.keys(room.timeControlUsed || {}),
    roomCount: room.roomCount || getAlivePlayers(room).length,
    chaosMode,
    roomAllotmentHistory: getRoomAllotmentHistory(
      room,
      shouldRevealRoles,
      viewerPlayer
    ),
  };
}

function emitGameUpdate(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  room.players.forEach((player) => {
    if (player.id) {
      io.to(player.id).emit("game-phase-updated", getPublicRoom(roomCode, player.id));
    }
  });
}

function emitRoomUpdate(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  if (room.gameStarted) {
    emitGameUpdate(roomCode);
  } else {
    io.to(roomCode).emit("room-updated", getPublicRoom(roomCode));
  }
}

function shuffleArray(array) {
  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[randomIndex]] = [copy[randomIndex], copy[i]];
  }

  return copy;
}

function createPublicNameMap(players) {
  const realNames = players.map((player) => player.name);

  if (players.length <= 1) {
    return realNames;
  }

  let shuffledNames = shuffleArray(realNames);
  let attempts = 0;

  while (
    shuffledNames.some((name, index) => name === players[index].name) &&
    attempts < 100
  ) {
    shuffledNames = shuffleArray(realNames);
    attempts += 1;
  }

  if (shuffledNames.some((name, index) => name === players[index].name)) {
    shuffledNames.push(shuffledNames.shift());
  }

  return shuffledNames;
}

function assignRoles(players, settings) {
  const roles = [];

  for (let i = 0; i < settings.mafiaCount; i++) {
    roles.push("Mafia");
  }

  for (let i = 0; i < settings.doctorCount; i++) {
    roles.push("Doctor");
  }

  while (roles.length < players.length) {
    roles.push("Villager");
  }

  const shuffledRoles = shuffleArray(roles);

  return players.map((player, index) => ({
    ...player,
    role: shuffledRoles[index],
    alive: true,
    connected: true,
    disconnected: false,
    gone: false,
    reconnectDeadline: null,
    disconnectTimer: null,
    roomNumber: null,
    selectedRoom: null,
    roomHistory: [],
  }));
}

function applyChaosPublicNames(room) {
  const publicNames = createPublicNameMap(room.players);

  room.players = room.players.map((player, index) => ({
    ...player,
    publicName: publicNames[index],
  }));
}

function clearRoomTimer(room) {
  if (room.phaseTimer) {
    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
  }
}

function clearPlayerDisconnectTimer(player) {
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
}

function schedulePhaseEnd(roomCode, durationMs) {
  const room = rooms[roomCode];

  if (!room || !durationMs || durationMs <= 0) return;

  const scheduledPhase = room.phase;

  room.phaseTimer = setTimeout(() => {
    handlePhaseEnd(roomCode, scheduledPhase);
  }, durationMs);
}

function setPhase(roomCode, phase, durationMs, extraData = {}) {
  const room = rooms[roomCode];

  if (!room) return;

  clearRoomTimer(room);

  room.phase = phase;
  room.phaseEndsAt =
    durationMs && durationMs > 0 ? Date.now() + durationMs : null;

  Object.assign(room, extraData);

  emitGameUpdate(roomCode);

  schedulePhaseEnd(roomCode, durationMs);
}

function getPlayer(room, socketId) {
  return room.players.find((player) => player.id === socketId);
}

function getPlayerByKey(room, playerKey) {
  return room.players.find((player) => player.playerKey === playerKey);
}

function getPlayerByName(room, playerName) {
  return room.players.find(
    (player) =>
      player.name.trim().toLowerCase() === playerName.trim().toLowerCase()
  );
}

function getAlivePlayers(room) {
  return room.players.filter((player) => player.alive && !player.gone);
}

function circularDistance(roomA, roomB, totalRooms) {
  const normalDistance = Math.abs(roomA - roomB);
  return Math.min(normalDistance, totalRooms - normalDistance);
}

function getOppositeRoom(roomNumber, totalRooms) {
  if (totalRooms % 2 !== 0) return null;

  return ((roomNumber + totalRooms / 2 - 1) % totalRooms) + 1;
}

function canMafiaAttack(room, mafiaPlayer, targetPlayer) {
  if (!targetPlayer.alive || targetPlayer.gone) return false;
  if (mafiaPlayer.id === targetPlayer.id) return false;

  if (!isChaosMode(room)) return true;

  const aliveCount = getAlivePlayers(room).length;

  if (aliveCount <= 5) return true;
  if (aliveCount % 2 !== 0) return true;

  const oppositeRoom = getOppositeRoom(mafiaPlayer.roomNumber, aliveCount);

  return targetPlayer.roomNumber !== oppositeRoom;
}

function canDoctorHeal(room, doctorPlayer, targetPlayer) {
  if (!targetPlayer.alive || targetPlayer.gone) return false;

  if (!isChaosMode(room)) return true;

  const aliveCount = getAlivePlayers(room).length;

  if (aliveCount <= 5) return true;

  return circularDistance(
    doctorPlayer.roomNumber,
    targetPlayer.roomNumber,
    aliveCount
  ) <= 1;
}

function saveRoomAllotmentSnapshot(room) {
  const roomPlayers = room.players
    .filter((player) => player.roomNumber)
    .sort((a, b) => a.roomNumber - b.roomNumber);

  const snapshot = {
    day: room.dayNumber,
    roomCount: room.roomCount,
    rooms: roomPlayers.map((player) => ({
      roomNumber: player.roomNumber,
      realName: player.name,
      publicName: player.publicName || player.name,
    })),
  };

  if (!room.roomAllotmentHistory) {
    room.roomAllotmentHistory = [];
  }

  const existingIndex = room.roomAllotmentHistory.findIndex(
    (item) => item.day === room.dayNumber
  );

  if (existingIndex !== -1) {
    room.roomAllotmentHistory[existingIndex] = snapshot;
  } else {
    room.roomAllotmentHistory.push(snapshot);
  }
}

function resetDailyRoomData(room) {
  if (!isChaosMode(room)) return;

  room.players.forEach((player) => {
    player.roomNumber = null;
    player.selectedRoom = null;
  });

  room.roomCount = getAlivePlayers(room).length;
}

function assignRandomRooms(room) {
  const alivePlayers = getAlivePlayers(room);
  const roomNumbers = shuffleArray(
    Array.from({ length: alivePlayers.length }, (_, index) => index + 1)
  );

  room.roomCount = alivePlayers.length;

  alivePlayers.forEach((player, index) => {
    player.roomNumber = roomNumbers[index];
    player.selectedRoom = null;

    if (!player.roomHistory) {
      player.roomHistory = [];
    }

    player.roomHistory.push({
      day: room.dayNumber,
      roomNumber: player.roomNumber,
    });
  });

  saveRoomAllotmentSnapshot(room);
}

function assignSelectedRooms(room) {
  const alivePlayers = getAlivePlayers(room);
  const roomCount = alivePlayers.length;
  const availableRooms = Array.from({ length: roomCount }, (_, index) => index + 1);

  room.roomCount = roomCount;

  alivePlayers.forEach((player) => {
    player.roomNumber = null;
  });

  const chosenRooms = new Set();

  alivePlayers.forEach((player) => {
    const chosenRoom = Number(player.selectedRoom);

    if (
      chosenRoom >= 1 &&
      chosenRoom <= roomCount &&
      !chosenRooms.has(chosenRoom)
    ) {
      player.roomNumber = chosenRoom;
      chosenRooms.add(chosenRoom);

      const roomIndex = availableRooms.indexOf(chosenRoom);

      if (roomIndex !== -1) {
        availableRooms.splice(roomIndex, 1);
      }
    }
  });

  const shuffledLeftoverRooms = shuffleArray(availableRooms);

  alivePlayers.forEach((player) => {
    if (!player.roomNumber) {
      player.roomNumber = shuffledLeftoverRooms.shift();
    }
  });

  alivePlayers.forEach((player) => {
    if (!player.roomHistory) {
      player.roomHistory = [];
    }

    player.roomHistory.push({
      day: room.dayNumber,
      roomNumber: player.roomNumber,
    });

    player.selectedRoom = null;
  });

  saveRoomAllotmentSnapshot(room);
}

function checkWinner(room) {
  const alivePlayers = getAlivePlayers(room);
  const aliveMafia = alivePlayers.filter((player) => player.role === "Mafia");
  const aliveNonMafia = alivePlayers.filter(
    (player) => player.role !== "Mafia"
  );

  if (aliveMafia.length === 0) {
    return "Villagers";
  }

  if (aliveMafia.length >= aliveNonMafia.length) {
    return "Mafia";
  }

  return null;
}

function startStoryIntro(roomCode) {
  setPhase(roomCode, "storyIntro", PHASE_DURATIONS.storyIntro);
}

function startDayTitle(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  resetDailyRoomData(room);

  setPhase(roomCode, "dayTitle", PHASE_DURATIONS.dayTitle, {
    announcement: "",
    voteResultMessage: "",
  });
}

function startRoomSelection(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  resetDailyRoomData(room);

  setPhase(roomCode, "roomSelection", PHASE_DURATIONS.roomSelection);
}

function startNight(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  if (isChaosMode(room)) {
    const alivePlayers = getAlivePlayers(room);
    const playersWithoutRooms = alivePlayers.filter(
      (player) => !player.roomNumber
    );

    if (playersWithoutRooms.length > 0) {
      assignRandomRooms(room);
    }
  }

  setPhase(roomCode, "night", PHASE_DURATIONS.night, {
    mafiaTargetId: null,
    doctorTargetId: null,
    announcement: "",
    voteResultMessage: "",
  });
}

function resolveNight(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  let announcement = "No one died tonight.";

  const mafiaTarget = room.players.find(
    (player) => player.id === room.mafiaTargetId && player.alive
  );

  const doctorTarget = room.players.find(
    (player) => player.id === room.doctorTargetId && player.alive
  );

  if (mafiaTarget && doctorTarget && mafiaTarget.id === doctorTarget.id) {
    announcement = isChaosMode(room)
      ? `A player in Room ${mafiaTarget.roomNumber} was saved by the Doctor.`
      : `${getDisplayNameForViewer(room, mafiaTarget, null)} was saved by the Doctor.`;
  } else if (mafiaTarget) {
    mafiaTarget.alive = false;

    announcement = isChaosMode(room)
      ? `A player in Room ${mafiaTarget.roomNumber} has died.`
      : `${getDisplayNameForViewer(room, mafiaTarget, null)} has died.`;
  }

  const winner = checkWinner(room);

  if (winner) {
    room.winner = winner;
  }

  setPhase(roomCode, "nightResult", PHASE_DURATIONS.nightResult, {
    announcement,
  });
}

function startDiscussion(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  if (room.winner) {
    setPhase(roomCode, "gameOver", null);
    return;
  }

  const discussionDurationMs = room.settings.discussionTime * 60 * 1000;

  setPhase(roomCode, "discussion", discussionDurationMs, {
    chatMessages: [],
    timeControlUsed: {},
  });
}

function startVotingIntro(roomCode) {
  setPhase(roomCode, "votingIntro", PHASE_DURATIONS.votingIntro);
}

function startVoting(roomCode) {
  setPhase(roomCode, "voting", PHASE_DURATIONS.voting, {
    votes: {},
  });
}

function resolveVote(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  const aliveBeforeVote = getAlivePlayers(room);
  const aliveMafiaBeforeVote = aliveBeforeVote.filter(
    (player) => player.role === "Mafia"
  );
  const aliveNonMafiaBeforeVote = aliveBeforeVote.filter(
    (player) => player.role !== "Mafia"
  );

  const isFinalVotingSession =
    aliveBeforeVote.length === 3 &&
    aliveMafiaBeforeVote.length === 1 &&
    aliveNonMafiaBeforeVote.length === 2;

  const alivePlayerIds = getAlivePlayers(room).map((player) => player.id);

  const voteValues = Object.values(room.votes || {}).filter((targetId) =>
    alivePlayerIds.includes(targetId)
  );

  let voteResultMessage = "No player is eliminated.";
  let mafiaEliminatedThisVote = false;

  if (voteValues.length > 0) {
    const voteCounts = {};

    voteValues.forEach((targetId) => {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });

    const highestVoteCount = Math.max(...Object.values(voteCounts));

    const topVotedPlayerIds = Object.keys(voteCounts).filter(
      (targetId) => voteCounts[targetId] === highestVoteCount
    );

    if (topVotedPlayerIds.length > 1) {
      voteResultMessage = "No one is eliminated due to a tie in vote.";
    } else {
      const eliminatedPlayer = room.players.find(
        (player) => player.id === topVotedPlayerIds[0] && player.alive
      );

      if (eliminatedPlayer) {
        eliminatedPlayer.alive = false;

        if (eliminatedPlayer.role === "Mafia") {
          mafiaEliminatedThisVote = true;
          voteResultMessage = isChaosMode(room)
            ? "The eliminated player was the Mafia."
            : `${eliminatedPlayer.name} was the Mafia.`;
          room.winner = "Villagers";
        } else {
          voteResultMessage = isChaosMode(room)
            ? "The eliminated player was not the Mafia."
            : `${eliminatedPlayer.name} was not the Mafia.`;
        }
      }
    }
  }

  if (!room.winner) {
    const winner = checkWinner(room);

    if (winner) {
      room.winner = winner;
    }
  }

  if (!room.winner && isFinalVotingSession && !mafiaEliminatedThisVote) {
    room.winner = "Mafia";

    voteResultMessage +=
      " The village failed to eliminate the Mafia in the final vote.";
  }

  setPhase(roomCode, "voteResult", PHASE_DURATIONS.voteResult, {
    voteResultMessage,
  });
}

function handlePhaseEnd(roomCode, phase) {
  const room = rooms[roomCode];

  if (!room) return;
  if (room.phase !== phase) return;

  if (phase === "roleReveal") {
    startStoryIntro(roomCode);
    return;
  }

  if (phase === "storyIntro") {
    startDayTitle(roomCode);
    return;
  }

  if (phase === "dayTitle") {
    if (isChaosMode(room)) {
      if (room.dayNumber === 1) {
        assignRandomRooms(room);
        startNight(roomCode);
      } else {
        startRoomSelection(roomCode);
      }

      return;
    }

    startNight(roomCode);
    return;
  }

  if (phase === "roomSelection") {
    assignSelectedRooms(room);
    startNight(roomCode);
    return;
  }

  if (phase === "night") {
    resolveNight(roomCode);
    return;
  }

  if (phase === "nightResult") {
    startDiscussion(roomCode);
    return;
  }

  if (phase === "discussion") {
    startVotingIntro(roomCode);
    return;
  }

  if (phase === "votingIntro") {
    startVoting(roomCode);
    return;
  }

  if (phase === "voting") {
    resolveVote(roomCode);
    return;
  }

  if (phase === "voteResult") {
    if (room.winner) {
      setPhase(roomCode, "gameOver", null);
      return;
    }

    room.dayNumber += 1;
    startDayTitle(roomCode);
  }
}

function markDisconnectedPlayerAsGone(roomCode, playerKey) {
  const room = rooms[roomCode];

  if (!room) return;

  const player = getPlayerByKey(room, playerKey);

  if (!player) return;
  if (!player.disconnected) return;
  if (!player.alive) return;

  player.connected = false;
  player.disconnected = false;
  player.gone = true;
  player.alive = false;
  player.reconnectDeadline = null;
  player.disconnectTimer = null;

  delete room.votes?.[player.id];

  const funnyMessage = getFunnyDisconnectMessage(player.name);
  addSystemMessage(room, funnyMessage);

  const winner = checkWinner(room);

  if (winner) {
    room.winner = winner;
    setPhase(roomCode, "gameOver", null);
    return;
  }

  emitRoomUpdate(roomCode);
}

function transferPlayerSocketIdentity(room, oldSocketId, newSocketId) {
  if (room.hostId === oldSocketId) {
    room.hostId = newSocketId;
  }

  if (room.mafiaTargetId === oldSocketId) {
    room.mafiaTargetId = newSocketId;
  }

  if (room.doctorTargetId === oldSocketId) {
    room.doctorTargetId = newSocketId;
  }

  if (room.votes && room.votes[oldSocketId] !== undefined) {
    room.votes[newSocketId] = room.votes[oldSocketId];
    delete room.votes[oldSocketId];
  }

  if (room.votes) {
    Object.keys(room.votes).forEach((voterId) => {
      if (room.votes[voterId] === oldSocketId) {
        room.votes[voterId] = newSocketId;
      }
    });
  }
}

function reconnectExistingPlayer({
  socket,
  roomCode,
  room,
  player,
  cleanPlayerKey,
  callback,
}) {
  if (!player) {
    callback({
      success: false,
      message: "Player not found in this room.",
    });
    return;
  }

  if (player.gone) {
    callback({
      success: false,
      message: "You were already removed from the village.",
    });
    return;
  }

  if (!player.disconnected || !player.alive) {
    callback({
      success: false,
      message: "This player is already connected.",
    });
    return;
  }

  if (player.reconnectDeadline && Date.now() > player.reconnectDeadline) {
    callback({
      success: false,
      message: "Reconnect time expired.",
    });
    return;
  }

  const oldSocketId = player.id;

  transferPlayerSocketIdentity(room, oldSocketId, socket.id);

  player.id = socket.id;
  player.playerKey = cleanPlayerKey;
  player.connected = true;
  player.disconnected = false;
  player.reconnectDeadline = null;

  clearPlayerDisconnectTimer(player);

  socket.join(roomCode);

  addSystemMessage(room, `${player.name} returned to the village.`);

  callback({
    success: true,
    room: getPublicRoom(roomCode, socket.id),
    playerId: socket.id,
    gameStarted: room.gameStarted,
    yourRole: player.role || "",
    yourRoleDescription: ROLE_DESCRIPTIONS[player.role] || "",
  });

  emitRoomUpdate(roomCode);

  socket.emit("game-started", {
    room: getPublicRoom(roomCode, socket.id),
    yourRole: player.role,
    yourRoleDescription: ROLE_DESCRIPTIONS[player.role],
  });
}

app.get("/", (req, res) => {
  res.send("Project Chaos backend is running.");
});

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("create-room", ({ playerName, playerKey }, callback) => {
    const nameValidation = validatePlayerName(playerName);
    const cleanPlayerKey = String(playerKey || "").trim();

    if (!nameValidation.success) {
      callback({
        success: false,
        message: nameValidation.message,
      });
      return;
    }

    if (!cleanPlayerKey) {
      callback({
        success: false,
        message: "Player session is invalid.",
      });
      return;
    }

    const cleanPlayerName = nameValidation.name;

    let roomCode = createRoomCode();

    while (rooms[roomCode]) {
      roomCode = createRoomCode();
    }

    rooms[roomCode] = {
      hostId: socket.id,
      players: [
        {
          id: socket.id,
          playerKey: cleanPlayerKey,
          name: cleanPlayerName,
          publicName: cleanPlayerName,
          type: "Host",
          alive: true,
          connected: true,
          disconnected: false,
          gone: false,
          reconnectDeadline: null,
          disconnectTimer: null,
          roomNumber: null,
          selectedRoom: null,
          roomHistory: [],
        },
      ],
      settings: normalizeSettings(
        {
          mode: "Classic Demo",
          mafiaCount: 1,
          doctorCount: 1,
          discussionTime: 2,
        },
        1
      ),
      gameStarted: false,
      phase: "lobby",
      dayNumber: 1,
      phaseEndsAt: null,
      announcement: "",
      voteResultMessage: "",
      winner: null,
      chatMessages: [],
      lobbyMessages: [],
      systemMessages: [],
      timeControlUsed: {},
      votes: {},
      mafiaTargetId: null,
      doctorTargetId: null,
      roomCount: 0,
      roomAllotmentHistory: [],
      phaseTimer: null,
    };

    socket.join(roomCode);

    callback({
      success: true,
      room: getPublicRoom(roomCode),
      playerId: socket.id,
    });

    io.to(roomCode).emit("room-updated", getPublicRoom(roomCode));
  });

  socket.on("join-room", ({ roomCode, playerName, playerKey }, callback) => {
    const room = rooms[roomCode];
    const nameValidation = validatePlayerName(playerName);
    const cleanPlayerKey = String(playerKey || "").trim();

    if (!room) {
      callback({
        success: false,
        message: "Room not found.",
      });
      return;
    }

    if (!nameValidation.success) {
      callback({
        success: false,
        message: nameValidation.message,
      });
      return;
    }

    if (!cleanPlayerKey) {
      callback({
        success: false,
        message: "Player session is invalid.",
      });
      return;
    }

    const cleanPlayerName = nameValidation.name;

    if (room.gameStarted) {
      const playerByKey = getPlayerByKey(room, cleanPlayerKey);
      const playerByName = getPlayerByName(room, cleanPlayerName);
      const reconnectPlayer = playerByKey || playerByName;

      if (!reconnectPlayer) {
        callback({
          success: false,
          message: "Game already started.",
        });
        return;
      }

      reconnectExistingPlayer({
        socket,
        roomCode,
        room,
        player: reconnectPlayer,
        cleanPlayerKey,
        callback,
      });

      return;
    }

    const duplicateName = room.players.some(
      (player) =>
        player.name.trim().toLowerCase() === cleanPlayerName.toLowerCase()
    );

    if (duplicateName) {
      callback({
        success: false,
        message: "This name is already taken in this room.",
      });
      return;
    }

    room.players.push({
      id: socket.id,
      playerKey: cleanPlayerKey,
      name: cleanPlayerName,
      publicName: cleanPlayerName,
      type: "Player",
      alive: true,
      connected: true,
      disconnected: false,
      gone: false,
      reconnectDeadline: null,
      disconnectTimer: null,
      roomNumber: null,
      selectedRoom: null,
      roomHistory: [],
    });

    room.settings = normalizeSettings(room.settings, room.players.length);

    socket.join(roomCode);

    callback({
      success: true,
      room: getPublicRoom(roomCode),
      playerId: socket.id,
    });

    io.to(roomCode).emit("room-updated", getPublicRoom(roomCode));
  });

  socket.on("reconnect-player", ({ roomCode, playerKey }, callback) => {
    const room = rooms[roomCode];
    const cleanPlayerKey = String(playerKey || "").trim();

    if (!room || !cleanPlayerKey) {
      callback({
        success: false,
        message: "Reconnect failed.",
      });
      return;
    }

    const player = getPlayerByKey(room, cleanPlayerKey);

    reconnectExistingPlayer({
      socket,
      roomCode,
      room,
      player,
      cleanPlayerKey,
      callback,
    });
  });

  socket.on("send-lobby-chat", ({ roomCode, message }) => {
    const room = rooms[roomCode];

    if (!room) return;
    if (room.phase !== "lobby") return;

    const player = getPlayer(room, socket.id);

    if (!player) return;

    const trimmedMessage = String(message || "").trim();

    if (!trimmedMessage) return;

    room.lobbyMessages.push({
      id: Date.now() + Math.random(),
      playerId: player.id,
      playerName: player.name,
      message: trimmedMessage,
    });

    io.to(roomCode).emit("room-updated", getPublicRoom(roomCode));
  });

  socket.on("update-settings", ({ roomCode, settings }) => {
    const room = rooms[roomCode];

    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.gameStarted) return;

    room.settings = normalizeSettings(settings, room.players.length);

    io.to(roomCode).emit("room-updated", getPublicRoom(roomCode));
  });

  socket.on("start-game", (roomCode) => {
    const room = rooms[roomCode];

    if (!room) return;
    if (room.hostId !== socket.id) return;

    room.settings = normalizeSettings(room.settings, room.players.length);

    const minimumPlayers = getMinimumPlayers(room.settings.mode);

    if (room.players.length < minimumPlayers) {
      socket.emit(
        "game-error",
        `${room.settings.mode} requires at least ${minimumPlayers} players.`
      );
      return;
    }

    const totalSpecialRoles =
      room.settings.mafiaCount + room.settings.doctorCount;

    if (totalSpecialRoles > room.players.length) {
      socket.emit(
        "game-error",
        "Not enough players for the selected Mafia and Doctor count."
      );
      return;
    }

    room.players = assignRoles(room.players, room.settings);

    if (isChaosMode(room)) {
      applyChaosPublicNames(room);
    }

    room.gameStarted = true;
    room.phase = "roleReveal";
    room.dayNumber = 1;
    room.phaseEndsAt = Date.now() + PHASE_DURATIONS.roleReveal;
    room.announcement = "";
    room.voteResultMessage = "";
    room.winner = null;
    room.chatMessages = [];
    room.timeControlUsed = {};
    room.votes = {};
    room.mafiaTargetId = null;
    room.doctorTargetId = null;
    room.systemMessages = [];
    room.roomCount = room.players.length;
    room.roomAllotmentHistory = [];

    room.players.forEach((player) => {
      io.to(player.id).emit("game-started", {
        room: getPublicRoom(roomCode, player.id),
        yourRole: player.role,
        yourRoleDescription: ROLE_DESCRIPTIONS[player.role],
      });
    });

    emitGameUpdate(roomCode);

    clearRoomTimer(room);
    schedulePhaseEnd(roomCode, PHASE_DURATIONS.roleReveal);
  });

  socket.on("select-room", ({ roomCode, roomNumber }) => {
    const room = rooms[roomCode];

    if (!room) return;
    if (!isChaosMode(room)) return;
    if (room.phase !== "roomSelection") return;

    const player = getPlayer(room, socket.id);

    if (!player || !player.alive || player.disconnected || player.gone) return;

    const chosenRoom = Number(roomNumber);
    const roomCount = getAlivePlayers(room).length;

    if (chosenRoom < 1 || chosenRoom > roomCount) return;

    const alreadyTaken = getAlivePlayers(room).some(
      (roomPlayer) =>
        roomPlayer.id !== player.id && roomPlayer.selectedRoom === chosenRoom
    );

    if (alreadyTaken) return;

    player.selectedRoom = chosenRoom;

    emitGameUpdate(roomCode);
  });

  socket.on("night-action", ({ roomCode, targetId }) => {
    const room = rooms[roomCode];

    if (!room) return;
    if (room.phase !== "night") return;

    const player = getPlayer(room, socket.id);
    const target = room.players.find(
      (roomPlayer) => roomPlayer.id === targetId && roomPlayer.alive
    );

    if (!player || !target) return;
    if (!player.alive || player.disconnected || player.gone) return;

    if (player.role === "Mafia") {
      if (!canMafiaAttack(room, player, target)) return;

      room.mafiaTargetId = target.id;

      socket.emit("action-confirmed", {
        message: `You selected ${getDisplayNameForViewer(
          room,
          target,
          player
        )} to eliminate.`,
        targetId: target.id,
      });
    }

    if (player.role === "Doctor") {
      if (!canDoctorHeal(room, player, target)) return;

      room.doctorTargetId = target.id;

      socket.emit("action-confirmed", {
        message: `You selected ${getDisplayNameForViewer(
          room,
          target,
          player
        )} to heal.`,
        targetId: target.id,
      });
    }
  });

  socket.on("send-chat", ({ roomCode, message }) => {
    const room = rooms[roomCode];

    if (!room) return;
    if (room.phase !== "discussion") return;

    const player = getPlayer(room, socket.id);

    if (!player || !player.alive || player.disconnected || player.gone) return;

    const trimmedMessage = String(message || "").trim();

    if (!trimmedMessage) return;

    room.chatMessages.push({
      id: Date.now() + Math.random(),
      playerId: player.id,
      playerKey: player.playerKey,
      realPlayerName: player.name,
      publicPlayerName: getDisplayNameForViewer(room, player, null),
      playerName: getDisplayNameForViewer(room, player, null),
      message: trimmedMessage,
    });

    emitGameUpdate(roomCode);
  });

  socket.on("adjust-discussion-time", ({ roomCode, delta }) => {
    const room = rooms[roomCode];

    if (!room) return;
    if (room.phase !== "discussion") return;

    const player = getPlayer(room, socket.id);

    if (!player || !player.alive || player.disconnected || player.gone) return;

    if (room.timeControlUsed[player.id]) return;

    const safeDelta =
      Number(delta) === 30 ? 30 : Number(delta) === -30 ? -30 : 0;

    if (safeDelta === 0) return;

    room.timeControlUsed[player.id] = true;

    const remainingMs = room.phaseEndsAt - Date.now();

    if (safeDelta === -30 && remainingMs <= 30000) {
      room.phaseEndsAt = Date.now();

      clearRoomTimer(room);

      emitGameUpdate(roomCode);

      setTimeout(() => {
        handlePhaseEnd(roomCode, "discussion");
      }, 100);

      return;
    }

    room.phaseEndsAt = Math.max(
      Date.now(),
      room.phaseEndsAt + safeDelta * 1000
    );

    clearRoomTimer(room);

    const newRemainingMs = room.phaseEndsAt - Date.now();

    if (newRemainingMs <= 0) {
      emitGameUpdate(roomCode);

      setTimeout(() => {
        handlePhaseEnd(roomCode, "discussion");
      }, 100);

      return;
    }

    schedulePhaseEnd(roomCode, newRemainingMs);

    emitGameUpdate(roomCode);
  });

  socket.on("cast-vote", ({ roomCode, targetId }) => {
    const room = rooms[roomCode];

    if (!room) return;
    if (room.phase !== "voting") return;

    const voter = getPlayer(room, socket.id);

    if (!voter || !voter.alive || voter.disconnected || voter.gone) return;

    if (targetId) {
      const target = room.players.find(
        (player) => player.id === targetId && player.alive
      );

      if (!target) return;
    }

    room.votes[voter.id] = targetId || null;

    socket.emit("vote-confirmed", {
      targetId: targetId || null,
    });
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    for (const roomCode in rooms) {
      const room = rooms[roomCode];

      const player = room.players.find(
        (roomPlayer) => roomPlayer.id === socket.id
      );

      if (!player) continue;

      if (!room.gameStarted) {
        room.players = room.players.filter(
          (roomPlayer) => roomPlayer.id !== socket.id
        );

        if (room.players.length === 0) {
          clearRoomTimer(room);
          delete rooms[roomCode];
          continue;
        }

        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
          room.players[0].type = "Host";
        }

        room.settings = normalizeSettings(room.settings, room.players.length);

        io.to(roomCode).emit("room-updated", getPublicRoom(roomCode));
        continue;
      }

      if (!player.alive || player.gone) {
        player.connected = false;
        emitRoomUpdate(roomCode);
        continue;
      }

      player.connected = false;
      player.disconnected = true;
      player.reconnectDeadline = Date.now() + RECONNECT_GRACE_TIME;

      clearPlayerDisconnectTimer(player);

      addSystemMessage(
        room,
        `${player.name} disconnected. Waiting 60 seconds for them to return...`
      );

      player.disconnectTimer = setTimeout(() => {
        markDisconnectedPlayerAsGone(roomCode, player.playerKey);
      }, RECONNECT_GRACE_TIME);

      emitRoomUpdate(roomCode);
    }
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Project Chaos backend running on port ${PORT}`);
});