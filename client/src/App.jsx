import { useEffect, useState } from "react";
import { io } from "socket.io-client";

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

function validatePlayerNameInput(playerName) {
  const cleanPlayerName = String(playerName || "").trim();

  if (!cleanPlayerName) {
    return "Please enter a valid name.";
  }

  if (cleanPlayerName.length > 10) {
    return "Name cannot be more than 10 characters.";
  }

  if (!/^[a-zA-Z0-9]+$/.test(cleanPlayerName)) {
    return "Name can contain only letters and numbers. No spaces or symbols.";
  }

  if (/^\d+$/.test(cleanPlayerName)) {
    return "Name cannot be only numbers.";
  }

  const lowerName = cleanPlayerName.toLowerCase();

  const hasBlockedWord = BLOCKED_NAME_WORDS.some((word) =>
    lowerName.includes(word)
  );

  if (hasBlockedWord) {
    return "Please choose a clean name.";
  }

  return "";
}

function getOrCreatePlayerKey() {
  const existingKey = sessionStorage.getItem("projectChaosPlayerKey");

  if (existingKey) return existingKey;

  const newKey =
    crypto.randomUUID?.() ||
    `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  sessionStorage.setItem("projectChaosPlayerKey", newKey);

  return newKey;
}

const PLAYER_KEY = getOrCreatePlayerKey();
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

const socket = io(SERVER_URL);

const STORY_INTRO = `Welcome to Mafia 2.0

Every smile can hide a secret.

Every vote can change fate.

Your closest ally...

may be your greatest enemy.

Choose wisely.

Survive the chaos.

Good luck.`;

const defaultSettings = {
  mode: "Classic Demo",
  mafiaCount: 1,
  doctorCount: 1,
  discussionTime: 2,
};

function TypewriterText({ text, speed = 55, style }) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    setDisplayedText("");

    let index = 0;

    const intervalId = setInterval(() => {
      setDisplayedText(text.slice(0, index + 1));
      index += 1;

      if (index >= text.length) {
        clearInterval(intervalId);
      }
    }, speed);

    return () => clearInterval(intervalId);
  }, [text, speed]);

  return <p style={style}>{displayedText}</p>;
}

function App() {
  const [playerName, setPlayerName] = useState("");
  const [screen, setScreen] = useState("start");
  const [joinCode, setJoinCode] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [room, setRoom] = useState(null);
  const [yourRole, setYourRole] = useState("");
  const [yourRoleDescription, setYourRoleDescription] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [selectedNightTarget, setSelectedNightTarget] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [lobbyChatInput, setLobbyChatInput] = useState("");
  const [selectedVote, setSelectedVote] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [showRoomHistory, setShowRoomHistory] = useState(false);

  const isHost = room && room.hostId === playerId;
  const players = room?.players || [];
  const settings = room?.settings || defaultSettings;
  const roleLimits = room?.roleLimits || {
    mafiaMin: 1,
    mafiaMax: 1,
    doctorMin: 1,
    doctorMax: 1,
    locked: true,
  };
  const currentPlayer = players.find((player) => player.id === playerId);
  const isAlive = currentPlayer ? currentPlayer.alive : true;
  const isDisconnected = currentPlayer ? currentPlayer.disconnected : false;
  const isGone = currentPlayer ? currentPlayer.gone : false;
  const canParticipate = isAlive && !isDisconnected && !isGone;
  const alivePlayers = players.filter((player) => player.alive && !player.gone);
  const usedTimeControl = room?.timeControlUsedPlayerIds?.includes(playerId);
  const isChaos = room?.settings?.mode === "Chaos Demo";
  const roomHistory = room?.roomAllotmentHistory || [];

  useEffect(() => {
    socket.on("connect", () => {
      setPlayerId(socket.id);

      const savedRoomCode = sessionStorage.getItem("projectChaosRoomCode");
      const savedPlayerName = sessionStorage.getItem("projectChaosPlayerName");

      if (savedRoomCode && savedPlayerName) {
        socket.emit(
          "reconnect-player",
          {
            roomCode: savedRoomCode,
            playerKey: PLAYER_KEY,
          },
          (response) => {
            if (!response.success) {
              sessionStorage.removeItem("projectChaosRoomCode");
              sessionStorage.removeItem("projectChaosPlayerName");
              return;
            }

            setPlayerId(response.playerId);
            setRoom(response.room);
            setPlayerName(savedPlayerName);

            if (response.yourRole) {
              setYourRole(response.yourRole);
              setYourRoleDescription(response.yourRoleDescription);
            }

            setScreen(response.gameStarted ? "game" : "lobby");
          }
        );
      }
    });

    socket.on("room-updated", (updatedRoom) => {
      setRoom(updatedRoom);
    });

    socket.on("game-started", (data) => {
      setRoom(data.room);
      setYourRole(data.yourRole);
      setYourRoleDescription(data.yourRoleDescription);
      setScreen("game");
    });

    socket.on("game-phase-updated", (updatedRoom) => {
      setRoom(updatedRoom);
    });

    socket.on("game-error", (message) => {
      alert(message);
    });

    socket.on("action-confirmed", (data) => {
      setSelectedNightTarget(data.targetId);
    });

    socket.on("vote-confirmed", (data) => {
      setSelectedVote(data.targetId || "skip");
    });

    return () => {
      socket.off("connect");
      socket.off("room-updated");
      socket.off("game-started");
      socket.off("game-phase-updated");
      socket.off("game-error");
      socket.off("action-confirmed");
      socket.off("vote-confirmed");
    };
  }, []);

  useEffect(() => {
    if (!room?.phaseEndsAt) {
      setTimeLeft(0);
      return;
    }

    function updateTimeLeft() {
      const remainingSeconds = Math.max(
        0,
        Math.ceil((room.phaseEndsAt - Date.now()) / 1000)
      );

      setTimeLeft(remainingSeconds);
    }

    updateTimeLeft();

    const intervalId = setInterval(updateTimeLeft, 500);

    return () => clearInterval(intervalId);
  }, [room?.phaseEndsAt]);

  useEffect(() => {
    setSelectedNightTarget("");
    setSelectedVote("");
    setChatInput("");
  }, [room?.phase, room?.dayNumber]);

  function saveActiveSession(roomCode, name) {
    sessionStorage.setItem("projectChaosRoomCode", roomCode);
    sessionStorage.setItem("projectChaosPlayerName", name);
  }

  function getChatDisplayName(chat) {
    if (chat.playerId === playerId) {
      return playerName || "You";
    }

    return chat.playerName;
  }

  function getCurrentRoomSnapshot() {
    return roomHistory.find((snapshot) => snapshot.day === room?.dayNumber);
  }

  function circularDistance(roomA, roomB, totalRooms) {
    const normalDistance = Math.abs(roomA - roomB);
    return Math.min(normalDistance, totalRooms - normalDistance);
  }

  function getOppositeRoom(roomNumber, totalRooms) {
    if (totalRooms % 2 !== 0) return null;

    return ((roomNumber + totalRooms / 2 - 1) % totalRooms) + 1;
  }

  function canMafiaAttack(targetPlayer) {
    if (!targetPlayer.alive || targetPlayer.gone) return false;
    if (targetPlayer.id === playerId) return false;

    if (!isChaos) return true;

    const aliveCount = alivePlayers.length;

    if (aliveCount <= 5) return true;
    if (aliveCount % 2 !== 0) return true;

    const oppositeRoom = getOppositeRoom(currentPlayer?.roomNumber, aliveCount);

    return targetPlayer.roomNumber !== oppositeRoom;
  }

  function canDoctorHeal(targetPlayer) {
    if (!targetPlayer.alive || targetPlayer.gone) return false;

    if (!isChaos) return true;

    const aliveCount = alivePlayers.length;

    if (aliveCount <= 5) return true;

    return (
      circularDistance(
        currentPlayer?.roomNumber,
        targetPlayer.roomNumber,
        aliveCount
      ) <= 1
    );
  }

  function handleEnterGame() {
    const validationMessage = validatePlayerNameInput(playerName);

    if (validationMessage) {
      alert(validationMessage);
      return;
    }

    setPlayerName(playerName.trim());
    setScreen("roomSelection");
  }

  function handleCreateRoom() {
    const validationMessage = validatePlayerNameInput(playerName);

    if (validationMessage) {
      alert(validationMessage);
      return;
    }

    socket.emit(
      "create-room",
      {
        playerName: playerName.trim(),
        playerKey: PLAYER_KEY,
      },
      (response) => {
        if (!response.success) {
          alert(response.message);
          return;
        }

        saveActiveSession(response.room.roomCode, playerName.trim());
        setPlayerId(response.playerId);
        setRoom(response.room);
        setScreen("lobby");
      }
    );
  }

  function handleJoinRoom() {
    setScreen("joinRoom");
  }

  function handleJoinRoomSubmit() {
    const validationMessage = validatePlayerNameInput(playerName);

    if (validationMessage) {
      alert(validationMessage);
      return;
    }

    if (!joinCode.trim()) {
      alert("Please enter a room code.");
      return;
    }

    socket.emit(
      "join-room",
      {
        roomCode: joinCode.trim().toUpperCase(),
        playerName: playerName.trim(),
        playerKey: PLAYER_KEY,
      },
      (response) => {
        if (!response.success) {
          alert(response.message);
          return;
        }

        saveActiveSession(response.room.roomCode, playerName.trim());
        setPlayerId(response.playerId);
        setRoom(response.room);
        setScreen("lobby");
      }
    );
  }

  function handleSettingChange(key, value) {
    if (!room || !isHost) return;

    const updatedSettings = {
      ...settings,
      [key]: value,
    };

    socket.emit("update-settings", {
      roomCode: room.roomCode,
      settings: updatedSettings,
    });
  }

  function handleStartGame() {
    if (!room || !isHost) return;

    socket.emit("start-game", room.roomCode);
  }

  function handleSelectRoom(roomNumber) {
    if (!room) return;

    socket.emit("select-room", {
      roomCode: room.roomCode,
      roomNumber,
    });
  }

  async function handleCopyRoomCode() {
    if (!room?.roomCode) return;

    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopyMessage("Copied!");

      setTimeout(() => {
        setCopyMessage("");
      }, 1500);
    } catch {
      setCopyMessage("Copy failed. Select the code manually.");
    }
  }

  function handleSendLobbyChat() {
    if (!room || !lobbyChatInput.trim()) return;

    socket.emit("send-lobby-chat", {
      roomCode: room.roomCode,
      message: lobbyChatInput,
    });

    setLobbyChatInput("");
  }

  function handleLobbyChatKeyDown(event) {
    if (event.key === "Enter") {
      handleSendLobbyChat();
    }
  }

  function handleNightAction(targetId) {
    if (!room) return;

    socket.emit("night-action", {
      roomCode: room.roomCode,
      targetId,
    });

    setSelectedNightTarget(targetId);
  }

  function handleSendChat() {
    if (!room || !chatInput.trim()) return;

    socket.emit("send-chat", {
      roomCode: room.roomCode,
      message: chatInput,
    });

    setChatInput("");
  }

  function handleChatKeyDown(event) {
    if (event.key === "Enter") {
      handleSendChat();
    }
  }

  function handleAdjustDiscussionTime(delta) {
    if (!room) return;

    socket.emit("adjust-discussion-time", {
      roomCode: room.roomCode,
      delta,
    });
  }

  function handleVote(targetId) {
    if (!room) return;

    socket.emit("cast-vote", {
      roomCode: room.roomCode,
      targetId,
    });

    setSelectedVote(targetId || "skip");
  }

  function getPhaseLabel() {
    if (!room?.phase) return "Waiting";

    const labels = {
      lobby: "Lobby",
      roleReveal: "Role Reveal",
      storyIntro: "Story Intro",
      dayTitle: `Day ${room.dayNumber}`,
      roomSelection: "Room Selection",
      night: `Night ${room.dayNumber}`,
      nightResult: "Morning News",
      discussion: "Discussion",
      votingIntro: "Voting Begins",
      voting: "Voting",
      voteResult: "Vote Result",
      gameOver: "Game Over",
    };

    return labels[room.phase] || room.phase;
  }

  function getPlayerStatusText(player) {
    if (player.gone) return "Gone";
    if (player.disconnected) return "Disconnected";
    if (!player.alive) return "Dead";
    return "Alive";
  }

  function getPlayerStatusStyle(player) {
    if (player.gone) return styles.goneBadge;
    if (player.disconnected) return styles.disconnectedBadge;
    if (!player.alive) return styles.deadBadge;
    return styles.aliveBadge;
  }

  function getRoomStatusStyle(status) {
    if (status === "Dead") return styles.circleRoomDead;
    if (status === "Gone") return styles.circleRoomGone;
    if (status === "Disconnected") return styles.circleRoomDisconnected;
    return {};
  }

  function renderSystemMessages() {
    if (!room?.systemMessages?.length) return null;

    return (
      <div style={styles.systemBox}>
        {room.systemMessages.map((systemMessage) => (
          <p key={systemMessage.id} style={styles.systemMessage}>
            {systemMessage.message}
          </p>
        ))}
      </div>
    );
  }

  function renderRoomCircle(snapshot, title, subtitle) {
    if (!snapshot) return null;

    const roomCount = snapshot.roomCount;
    const roomNumbers = Array.from({ length: roomCount }, (_, index) => index + 1);

    return (
      <div style={styles.circleSection}>
        <h2 style={styles.sectionTitle}>{title}</h2>

        {subtitle && <p style={styles.smallText}>{subtitle}</p>}

        <div style={styles.circleBoard}>
          <div style={styles.circleCenter}>
            <strong>Day {snapshot.day}</strong>
            <span>{roomCount} Rooms</span>
          </div>

          {roomNumbers.map((roomNumber, index) => {
            const entry = snapshot.rooms.find(
              (roomEntry) => roomEntry.roomNumber === roomNumber
            );

            const angle = (2 * Math.PI * index) / roomCount - Math.PI / 2;
            const left = 50 + 39 * Math.cos(angle);
            const top = 50 + 39 * Math.sin(angle);

            return (
              <div
                key={roomNumber}
                style={{
                  ...styles.circleRoom,
                  ...getRoomStatusStyle(entry?.status),
                  left: `${left}%`,
                  top: `${top}%`,
                }}
              >
                <strong>Room {roomNumber}</strong>
                <span>({entry?.name || "Empty"})</span>
                {entry?.status && <small>{entry.status}</small>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderRoomHistoryPanel() {
    if (!showRoomHistory || !isChaos || !room?.gameStarted) return null;

    return (
      <div style={styles.sidebarHistoryPanel}>
        <h3 style={styles.sidebarHistoryTitle}>Room History</h3>

        {roomHistory.length === 0 ? (
          <p style={styles.sidebarHistoryText}>No room data yet.</p>
        ) : (
          roomHistory.map((snapshot) => (
            <div key={snapshot.day} style={styles.sidebarDayHistory}>
              <strong>Day {snapshot.day}</strong>

              {snapshot.rooms
                .slice()
                .sort((a, b) => a.roomNumber - b.roomNumber)
                .map((entry) => (
                  <p key={`${snapshot.day}-${entry.roomNumber}`}>
                    R{entry.roomNumber} ({entry.name}) - {entry.status}
                  </p>
                ))}
            </div>
          ))
        )}
      </div>
    );
  }

  function renderNoticeBoard() {
    if (!isChaos || !room?.gameStarted) return null;

    const currentSnapshot = getCurrentRoomSnapshot();

    if (!currentSnapshot) return null;

    return renderRoomCircle(
      currentSnapshot,
      "Village Room Circle",
      "Room arrangement stays visible for the full day, even if someone dies."
    );
  }

  function renderPlayerList() {
    return (
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Players</h2>

        {players.map((player) => (
          <div key={player.id} style={styles.playerRow}>
            <span>{player.name}</span>

            <div style={styles.badgeGroup}>
              <span
                style={
                  player.type === "Host" ? styles.hostBadge : styles.playerBadge
                }
              >
                {player.type}
              </span>

              {room?.gameStarted && (
                <span style={getPlayerStatusStyle(player)}>
                  {getPlayerStatusText(player)}
                </span>
              )}

              {room?.gameStarted && isChaos && player.roomNumber && (
                <span style={styles.roomBadge}>Room {player.roomNumber}</span>
              )}

              {player.role && <span style={styles.roleBadge}>{player.role}</span>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderTargetButtonContent(player, extraText) {
    if (!isChaos || !player.roomNumber) {
      return <span>{player.name}</span>;
    }

    return (
      <div style={styles.targetButtonContent}>
        <strong>Room {player.roomNumber}</strong>
        <span>({player.name})</span>
        {extraText && <small>{extraText}</small>}
      </div>
    );
  }

  function renderSidebar() {
    return (
      <aside style={styles.sidebar}>
        <h2 style={styles.sidebarTitle}>Mafia 2.0</h2>

        <div style={styles.sidebarRoleBox}>
          <p style={styles.sidebarLabel}>Your Role</p>
          <h3 style={styles.sidebarRole}>{yourRole || "Unknown"}</h3>
          <p style={styles.sidebarDescription}>{yourRoleDescription}</p>
        </div>

        {isChaos && currentPlayer?.roomNumber && (
          <div style={styles.sidebarMeta}>
            <p>
              <strong>Your Room:</strong> {currentPlayer.roomNumber}
            </p>

            <p>
              <strong>Alive Rooms:</strong> {room?.roomCount}
            </p>
          </div>
        )}

        <div style={styles.sidebarMeta}>
          <p>
            <strong>Phase:</strong> {getPhaseLabel()}
          </p>

          <p>
            <strong>Status:</strong>{" "}
            {currentPlayer ? getPlayerStatusText(currentPlayer) : "Unknown"}
          </p>

          {room?.phaseEndsAt && (
            <p>
              <strong>Timer:</strong> {timeLeft}s
            </p>
          )}
        </div>

        {isChaos && room?.gameStarted && (
          <>
            <button
              style={styles.sidebarButton}
              onClick={() => setShowRoomHistory((value) => !value)}
            >
              {showRoomHistory ? "Hide Room History" : "Room History"}
            </button>

            {renderRoomHistoryPanel()}
          </>
        )}

        <div style={styles.sidebarPlayers}>
          <h3>Players</h3>

          {players.map((player) => (
            <div key={player.id} style={styles.sidebarPlayerRow}>
              <span>
                {player.name}
                {isChaos && player.roomNumber ? ` · R${player.roomNumber}` : ""}
              </span>

              <span>
                {player.gone
                  ? "🏃"
                  : player.disconnected
                  ? "⚠️"
                  : player.alive
                  ? "🟢"
                  : "🔴"}
              </span>
            </div>
          ))}
        </div>
      </aside>
    );
  }

  function renderRoleReveal() {
    return (
      <div style={styles.card}>
        <h1 style={styles.title}>Your Role</h1>

        <div style={styles.section}>
          <h2 style={styles.roleName}>{yourRole}</h2>

          <TypewriterText
            text={yourRoleDescription}
            speed={55}
            style={styles.typingText}
          />
        </div>

        <p style={styles.smallText}>The game will continue automatically...</p>
      </div>
    );
  }

  function renderStoryIntro() {
    return (
      <div style={styles.storyCard}>
        <TypewriterText text={STORY_INTRO} speed={55} style={styles.storyText} />
      </div>
    );
  }

  function renderDayTitle() {
    return (
      <div style={styles.card}>
        <h1 style={styles.bigPhaseText}>Day {room?.dayNumber}</h1>

        {isChaos && room?.dayNumber === 1 && (
          <p style={styles.subtitle}>Rooms will be assigned randomly by the bot.</p>
        )}

        {isChaos && room?.dayNumber > 1 && (
          <p style={styles.subtitle}>Prepare to choose your room.</p>
        )}
      </div>
    );
  }

  function renderRoomSelectionCircle(roomNumbers, selectedRooms) {
    const roomCount = roomNumbers.length;

    return (
      <div style={styles.circleBoard}>
        <div style={styles.circleCenter}>
          <strong>Choose</strong>
          <span>Your Room</span>
        </div>

        {roomNumbers.map((roomNumber, index) => {
          const selectedPlayer = alivePlayers.find(
            (player) => player.selectedRoom === roomNumber
          );

          const takenByOther =
            selectedRooms.includes(roomNumber) &&
            currentPlayer?.selectedRoom !== roomNumber;

          const angle = (2 * Math.PI * index) / roomCount - Math.PI / 2;
          const left = 50 + 39 * Math.cos(angle);
          const top = 50 + 39 * Math.sin(angle);

          return (
            <button
              key={roomNumber}
              style={{
                ...styles.circleRoomButton,
                ...(currentPlayer?.selectedRoom === roomNumber
                  ? styles.selectedCircleRoom
                  : {}),
                ...(takenByOther ? styles.disabledRoomButton : {}),
                left: `${left}%`,
                top: `${top}%`,
              }}
              disabled={takenByOther}
              onClick={() => handleSelectRoom(roomNumber)}
            >
              <strong>Room {roomNumber}</strong>
              <span>({selectedPlayer?.name || "Empty"})</span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderRoomSelection() {
    const roomNumbers = Array.from(
      { length: room?.roomCount || alivePlayers.length },
      (_, index) => index + 1
    );

    const selectedRooms = alivePlayers
      .filter((player) => player.selectedRoom)
      .map((player) => player.selectedRoom);

    return (
      <div style={styles.wideCard}>
        <h1 style={styles.title}>Choose Your Room</h1>

        <p style={styles.timerText}>Time left: {timeLeft}s</p>

        <p style={styles.subtitle}>
          Select one room. If you do not choose, the bot will assign a leftover
          room.
        </p>

        {renderSystemMessages()}

        {canParticipate ? (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Room Circle</h2>

            {renderRoomSelectionCircle(roomNumbers, selectedRooms)}

            {currentPlayer?.selectedRoom && (
              <p style={styles.smallText}>
                You selected Room {currentPlayer.selectedRoom}.
              </p>
            )}
          </div>
        ) : (
          <div style={styles.announcementBox}>You cannot select a room.</div>
        )}

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Selections</h2>

          {alivePlayers.map((player) => (
            <div key={player.id} style={styles.playerRow}>
              <span>{player.name}</span>

              <span style={styles.roomBadge}>
                {player.selectedRoom ? `Room ${player.selectedRoom}` : "Not selected"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderNight() {
    return (
      <div style={styles.wideCard}>
        <h1 style={styles.title}>Night {room?.dayNumber}</h1>

        <p style={styles.timerText}>Time left: {timeLeft}s</p>

        {renderSystemMessages()}
        {renderNoticeBoard()}

        {isChaos && (
          <div style={styles.ruleBox}>
            {alivePlayers.length <= 5 ? (
              <p>Final stage: Mafia and Doctor restrictions are removed.</p>
            ) : (
              <>
                <p>
                  Mafia cannot attack the exact opposite room when room count is
                  even.
                </p>
                <p>Doctor can heal only self room or adjacent rooms.</p>
              </>
            )}
          </div>
        )}

        {!canParticipate && (
          <div style={styles.announcementBox}>You cannot act right now.</div>
        )}

        {canParticipate && yourRole === "Mafia" && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Choose one player to eliminate</h2>

            <div style={styles.actionGrid}>
              {alivePlayers
                .filter((player) => player.id !== playerId)
                .map((player) => {
                  const allowed = canMafiaAttack(player);

                  return (
                    <button
                      key={player.id}
                      style={{
                        ...styles.actionButton,
                        ...(selectedNightTarget === player.id
                          ? styles.selectedButton
                          : {}),
                        ...(!allowed ? styles.disabledRoomButton : {}),
                      }}
                      disabled={!allowed}
                      onClick={() => handleNightAction(player.id)}
                    >
                      {renderTargetButtonContent(
                        player,
                        !allowed ? "Restricted" : ""
                      )}
                    </button>
                  );
                })}
            </div>

            {selectedNightTarget && (
              <p style={styles.smallText}>
                Target selected. Wait for night to end.
              </p>
            )}
          </div>
        )}

        {canParticipate && yourRole === "Doctor" && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Choose one player to heal</h2>

            <div style={styles.actionGrid}>
              {alivePlayers.map((player) => {
                const allowed = canDoctorHeal(player);

                return (
                  <button
                    key={player.id}
                    style={{
                      ...styles.actionButton,
                      ...(selectedNightTarget === player.id
                        ? styles.selectedButton
                        : {}),
                      ...(!allowed ? styles.disabledRoomButton : {}),
                    }}
                    disabled={!allowed}
                    onClick={() => handleNightAction(player.id)}
                  >
                    {renderTargetButtonContent(
                      player,
                      !allowed ? "Out of range" : ""
                    )}
                  </button>
                );
              })}
            </div>

            {selectedNightTarget && (
              <p style={styles.smallText}>Heal selected. Wait for night to end.</p>
            )}
          </div>
        )}

        {canParticipate && yourRole === "Villager" && (
          <div style={styles.nightImageBox}>
            <h2>The village sleeps...</h2>
            <p>Wait quietly until morning.</p>
          </div>
        )}

        {renderPlayerList()}
      </div>
    );
  }

  function renderNightResult() {
    return (
      <div style={styles.wideCard}>
        <h1 style={styles.title}>Morning News</h1>

        <div style={styles.announcementBox}>{room?.announcement}</div>

        {renderSystemMessages()}
        {renderNoticeBoard()}

        <p style={styles.smallText}>Discussion will begin soon...</p>
      </div>
    );
  }

  function renderDiscussion() {
    return (
      <div style={styles.wideCard}>
        <h1 style={styles.title}>Discussion</h1>

        <p style={styles.timerText}>Time left: {timeLeft}s</p>

        {room?.announcement && (
          <div style={styles.announcementBox}>{room.announcement}</div>
        )}

        {renderSystemMessages()}
        {renderNoticeBoard()}

        <div style={styles.timeControlRow}>
          <button
            style={styles.smallButton}
            disabled={!canParticipate || usedTimeControl}
            onClick={() => handleAdjustDiscussionTime(30)}
          >
            +30 sec
          </button>

          <button
            style={styles.smallButton}
            disabled={!canParticipate || usedTimeControl}
            onClick={() => handleAdjustDiscussionTime(-30)}
          >
            -30 sec
          </button>
        </div>

        {usedTimeControl && (
          <p style={styles.smallText}>You already used your time control.</p>
        )}

        <div style={styles.chatBox}>
          <h2 style={styles.sectionTitle}>Live Chat</h2>

          <div style={styles.chatMessages}>
            {(room?.chatMessages || []).map((chat) => (
              <div key={chat.id} style={styles.chatMessage}>
                <strong>{getChatDisplayName(chat)}: </strong>
                <span>{chat.message}</span>
              </div>
            ))}
          </div>

          {canParticipate ? (
            <div style={styles.chatInputRow}>
              <input
                style={styles.chatInput}
                type="text"
                placeholder="Type your message..."
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={handleChatKeyDown}
              />

              <button style={styles.sendButton} onClick={handleSendChat}>
                Send
              </button>
            </div>
          ) : (
            <p style={styles.deadNotice}>You cannot participate in chat.</p>
          )}
        </div>

        {renderPlayerList()}
      </div>
    );
  }

  function renderVotingIntro() {
    return (
      <div style={styles.card}>
        <h1 style={styles.bigPhaseText}>Voting Begins</h1>
      </div>
    );
  }

  function renderVoting() {
    return (
      <div style={styles.wideCard}>
        <h1 style={styles.title}>Vote Now</h1>

        <p style={styles.timerText}>Time left: {timeLeft}s</p>

        {renderSystemMessages()}
        {renderNoticeBoard()}

        {canParticipate ? (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Choose one player or skip</h2>

            <div style={styles.actionGrid}>
              {alivePlayers
                .filter((player) => player.id !== playerId)
                .map((player) => (
                  <button
                    key={player.id}
                    style={{
                      ...styles.actionButton,
                      ...(selectedVote === player.id ? styles.selectedButton : {}),
                    }}
                    onClick={() => handleVote(player.id)}
                  >
                    {renderTargetButtonContent(player)}
                  </button>
                ))}

              <button
                style={{
                  ...styles.actionButton,
                  ...(selectedVote === "skip" ? styles.selectedButton : {}),
                }}
                onClick={() => handleVote(null)}
              >
                Skip Vote
              </button>
            </div>

            {selectedVote && (
              <p style={styles.smallText}>
                Vote locked for now. You can change it before time ends.
              </p>
            )}
          </div>
        ) : (
          <div style={styles.announcementBox}>You cannot vote.</div>
        )}

        {renderPlayerList()}
      </div>
    );
  }

  function renderVoteResult() {
    return (
      <div style={styles.wideCard}>
        <h1 style={styles.title}>Vote Result</h1>

        <div style={styles.announcementBox}>{room?.voteResultMessage}</div>

        {renderSystemMessages()}
        {renderNoticeBoard()}

        <p style={styles.smallText}>
          {room?.winner
            ? "Final result coming..."
            : "Rooms will reset when the new day starts."}
        </p>
      </div>
    );
  }

  function renderGameOver() {
    return (
      <div style={styles.wideCard}>
        <h1 style={styles.title}>Game Over</h1>

        <div style={styles.announcementBox}>
          {room?.winner === "Villagers"
            ? "Villagers have won."
            : "Mafia has won."}
        </div>

        {renderSystemMessages()}

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Final Role Reveal</h2>

          {players.map((player) => (
            <div key={player.id} style={styles.finalRevealCard}>
              <div>
                <strong>Real Name:</strong> {player.realName || player.name}
              </div>

              {isChaos && (
                <div>
                  <strong>Public Name:</strong> {player.publicName}
                </div>
              )}

              <div>
                <strong>Role:</strong> {player.role}
              </div>

              <div>
                <strong>Status:</strong> {getPlayerStatusText(player)}
              </div>

              {isChaos && player.roomHistory?.length > 0 && (
                <div>
                  <strong>Rooms:</strong>{" "}
                  {player.roomHistory
                    .map((item) => `Day ${item.day}: Room ${item.roomNumber}`)
                    .join(" | ")}
                </div>
              )}
            </div>
          ))}
        </div>

        {isChaos &&
          roomHistory.map((snapshot) =>
            renderRoomCircle(snapshot, `Day ${snapshot.day} Room Circle`)
          )}
      </div>
    );
  }

  function renderGameScreen() {
    if (!room) {
      return (
        <div style={styles.card}>
          <h1 style={styles.title}>Loading Game...</h1>
        </div>
      );
    }

    if (room.phase === "roleReveal") return renderRoleReveal();
    if (room.phase === "storyIntro") return renderStoryIntro();
    if (room.phase === "dayTitle") return renderDayTitle();
    if (room.phase === "roomSelection") return renderRoomSelection();
    if (room.phase === "night") return renderNight();
    if (room.phase === "nightResult") return renderNightResult();
    if (room.phase === "discussion") return renderDiscussion();
    if (room.phase === "votingIntro") return renderVotingIntro();
    if (room.phase === "voting") return renderVoting();
    if (room.phase === "voteResult") return renderVoteResult();
    if (room.phase === "gameOver") return renderGameOver();

    return (
      <div style={styles.card}>
        <h1 style={styles.title}>Unknown Phase</h1>
      </div>
    );
  }

  function renderLobbyChat() {
    return (
      <div style={styles.chatBox}>
        <h2 style={styles.sectionTitle}>Lobby Chat</h2>

        <div style={styles.chatMessages}>
          {(room?.lobbyMessages || []).map((chat) => (
            <div key={chat.id} style={styles.chatMessage}>
              <strong>{chat.playerName}: </strong>
              <span>{chat.message}</span>
            </div>
          ))}
        </div>

        <div style={styles.chatInputRow}>
          <input
            style={styles.chatInput}
            type="text"
            placeholder="Chat before the game starts..."
            value={lobbyChatInput}
            onChange={(event) => setLobbyChatInput(event.target.value)}
            onKeyDown={handleLobbyChatKeyDown}
          />

          <button style={styles.sendButton} onClick={handleSendLobbyChat}>
            Send
          </button>
        </div>
      </div>
    );
  }

  if (screen === "game") {
    return (
      <div style={styles.gamePage}>
        {renderSidebar()}

        <main style={styles.gameMain}>{renderGameScreen()}</main>
      </div>
    );
  }

  if (screen === "lobby") {
    return (
      <div style={styles.page}>
        <div style={styles.wideCard}>
          <h1 style={styles.title}>Game Lobby</h1>

          <div style={styles.roomCodeBox}>
            <p style={styles.smallText}>
              {isHost
                ? "Share this room code with your friends:"
                : "Joined Room:"}
            </p>

            <div style={styles.roomCodeRow}>
              <h2 style={styles.roomCode}>{room?.roomCode}</h2>

              <button style={styles.copyButton} onClick={handleCopyRoomCode}>
                Copy
              </button>
            </div>

            {copyMessage && <p style={styles.copyMessage}>{copyMessage}</p>}
          </div>

          {renderPlayerList()}

          {renderLobbyChat()}

          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Game Settings</h2>

            {isHost ? (
              <>
                <div style={styles.settingRow}>
                  <span>Mode</span>

                  <select
                    style={styles.select}
                    value={settings.mode}
                    onChange={(event) =>
                      handleSettingChange("mode", event.target.value)
                    }
                  >
                    <option>Classic Demo</option>
                    <option>Chaos Demo</option>
                  </select>
                </div>

                <div style={styles.settingRow}>
                  <span>Mafia/Hunter</span>

                  <input
                    style={styles.numberInput}
                    type="number"
                    min={roleLimits.mafiaMin}
                    max={roleLimits.mafiaMax}
                    disabled={roleLimits.locked}
                    value={settings.mafiaCount}
                    onChange={(event) =>
                      handleSettingChange(
                        "mafiaCount",
                        Number(event.target.value)
                      )
                    }
                  />
                </div>

                <div style={styles.settingRow}>
                  <span>Doctor</span>

                  <input
                    style={styles.numberInput}
                    type="number"
                    min={roleLimits.doctorMin}
                    max={roleLimits.doctorMax}
                    disabled={roleLimits.locked}
                    value={settings.doctorCount}
                    onChange={(event) =>
                      handleSettingChange(
                        "doctorCount",
                        Number(event.target.value)
                      )
                    }
                  />
                </div>

                <div style={styles.settingRow}>
                  <span>Discussion Time</span>

                  <input
                    style={styles.numberInput}
                    type="number"
                    min="1"
                    value={settings.discussionTime}
                    onChange={(event) =>
                      handleSettingChange(
                        "discussionTime",
                        Number(event.target.value)
                      )
                    }
                  />
                </div>

                <p style={styles.smallText}>
                  Classic Mode requires 6 players. Chaos Mode requires 8 players.
                </p>

                {roleLimits.locked ? (
                  <p style={styles.smallText}>
                    Mafia and Doctor count are fixed to 1 each for 6–10 players.
                  </p>
                ) : (
                  <p style={styles.smallText}>
                    Mafia allowed: {roleLimits.mafiaMin}–{roleLimits.mafiaMax}.
                    Doctor allowed: {roleLimits.doctorMin}–
                    {roleLimits.doctorMax}.
                  </p>
                )}
              </>
            ) : (
              <>
                <div style={styles.settingRow}>
                  <span>Mode</span>
                  <strong>{settings.mode}</strong>
                </div>

                <div style={styles.settingRow}>
                  <span>Mafia/Hunter</span>
                  <strong>{settings.mafiaCount}</strong>
                </div>

                <div style={styles.settingRow}>
                  <span>Doctor</span>
                  <strong>{settings.doctorCount}</strong>
                </div>

                <div style={styles.settingRow}>
                  <span>Discussion Time</span>
                  <strong>{settings.discussionTime} Minutes</strong>
                </div>
              </>
            )}
          </div>

          {isHost ? (
            <button style={styles.button} onClick={handleStartGame}>
              Start Game
            </button>
          ) : (
            <p style={styles.waitingText}>
              Waiting for host to start the game...
            </p>
          )}

          <button
            style={styles.backButton}
            onClick={() => setScreen("roomSelection")}
          >
            Back to Room Selection
          </button>
        </div>
      </div>
    );
  }

  if (screen === "joinRoom") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>Join Room</h1>

          <p style={styles.subtitle}>Enter the room code shared by the host.</p>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Room Code</label>

            <input
              style={styles.input}
              type="text"
              placeholder="Example: ROOM-1234"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
            />
          </div>

          <button style={styles.button} onClick={handleJoinRoomSubmit}>
            Join Room
          </button>

          <button
            style={styles.backButton}
            onClick={() => setScreen("roomSelection")}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (screen === "roomSelection") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>Choose Your Room</h1>

          <p style={styles.subtitle}>
            Welcome, <strong>{playerName}</strong>. Create a room or join your
            friends.
          </p>

          <button style={styles.button} onClick={handleCreateRoom}>
            Create Room
          </button>

          <button style={styles.secondaryButton} onClick={handleJoinRoom}>
            Join Room
          </button>

          <button style={styles.backButton} onClick={() => setScreen("start")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>PROJECT CHAOS</h1>

        <p style={styles.subtitle}>
          A social deduction game of trust, confusion, and survival.
        </p>

        <div style={styles.inputGroup}>
          <label style={styles.label}>Enter Your Real Name</label>

          <input
            style={styles.input}
            type="text"
            maxLength={10}
            placeholder="Example: Bunny"
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
          />

          <p style={styles.nameRuleText}>
            Max 10 characters. Letters/numbers only. Cannot be only numbers.
          </p>
        </div>

        <button style={styles.button} onClick={handleEnterGame}>
          Enter the Game
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(135deg, #050509 0%, #10091f 50%, #1d102b 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontFamily: "Arial, sans-serif",
    padding: "24px",
    boxSizing: "border-box",
  },
  gamePage: {
    minHeight: "100vh",
    background:
      "linear-gradient(135deg, #050509 0%, #10091f 50%, #1d102b 100%)",
    display: "flex",
    color: "white",
    fontFamily: "Arial, sans-serif",
  },
  sidebar: {
    width: "300px",
    minHeight: "100vh",
    padding: "24px",
    boxSizing: "border-box",
    background: "rgba(0, 0, 0, 0.45)",
    borderRight: "1px solid rgba(255, 255, 255, 0.12)",
    overflowY: "auto",
  },
  sidebarTitle: {
    marginTop: 0,
    fontSize: "26px",
    letterSpacing: "1px",
  },
  sidebarRoleBox: {
    padding: "16px",
    borderRadius: "14px",
    background: "rgba(139, 92, 246, 0.18)",
    border: "1px solid rgba(139, 92, 246, 0.45)",
    marginBottom: "20px",
  },
  sidebarLabel: {
    margin: 0,
    color: "#cfc7ff",
    fontSize: "13px",
  },
  sidebarRole: {
    margin: "8px 0",
    color: "#facc15",
    fontSize: "26px",
  },
  sidebarDescription: {
    color: "#ffffff",
    fontSize: "13px",
    lineHeight: "1.5",
  },
  sidebarMeta: {
    padding: "14px",
    borderRadius: "14px",
    background: "rgba(255, 255, 255, 0.06)",
    marginBottom: "20px",
    fontSize: "14px",
  },
  sidebarButton: {
    width: "100%",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    background: "rgba(20, 184, 166, 0.18)",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
    marginBottom: "14px",
  },
  sidebarHistoryPanel: {
    padding: "14px",
    borderRadius: "14px",
    background: "rgba(20, 184, 166, 0.1)",
    border: "1px solid rgba(20, 184, 166, 0.35)",
    marginBottom: "20px",
    maxHeight: "260px",
    overflowY: "auto",
  },
  sidebarHistoryTitle: {
    marginTop: 0,
    marginBottom: "12px",
  },
  sidebarHistoryText: {
    color: "#cfc7ff",
    fontSize: "13px",
  },
  sidebarDayHistory: {
    padding: "10px",
    borderRadius: "10px",
    background: "rgba(255, 255, 255, 0.06)",
    marginBottom: "10px",
    fontSize: "13px",
  },
  sidebarPlayers: {
    padding: "14px",
    borderRadius: "14px",
    background: "rgba(255, 255, 255, 0.06)",
  },
  sidebarPlayerRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    fontSize: "14px",
  },
  gameMain: {
    flex: 1,
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    boxSizing: "border-box",
  },
  card: {
    width: "430px",
    padding: "40px",
    borderRadius: "20px",
    background: "rgba(255, 255, 255, 0.08)",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.4)",
    textAlign: "center",
    border: "1px solid rgba(255, 255, 255, 0.15)",
  },
  wideCard: {
    width: "860px",
    maxHeight: "90vh",
    overflowY: "auto",
    padding: "40px",
    borderRadius: "20px",
    background: "rgba(255, 255, 255, 0.08)",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.4)",
    textAlign: "center",
    border: "1px solid rgba(255, 255, 255, 0.15)",
  },
  storyCard: {
    width: "720px",
    minHeight: "520px",
    padding: "50px",
    borderRadius: "20px",
    background: "rgba(0, 0, 0, 0.65)",
    boxShadow: "0 20px 80px rgba(0, 0, 0, 0.6)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: "42px",
    marginBottom: "12px",
    letterSpacing: "2px",
  },
  subtitle: {
    fontSize: "16px",
    color: "#cfc7ff",
    marginBottom: "32px",
    lineHeight: "1.5",
  },
  storyText: {
    fontSize: "26px",
    lineHeight: "1.9",
    color: "#ffffff",
    whiteSpace: "pre-line",
    textAlign: "center",
  },
  typingText: {
    fontSize: "18px",
    lineHeight: "1.7",
    color: "#ffffff",
    whiteSpace: "pre-line",
    textAlign: "center",
    minHeight: "70px",
  },
  bigPhaseText: {
    fontSize: "58px",
    letterSpacing: "4px",
  },
  timerText: {
    fontSize: "22px",
    fontWeight: "bold",
    color: "#facc15",
    marginBottom: "24px",
  },
  roomCodeBox: {
    padding: "18px",
    borderRadius: "14px",
    background: "rgba(139, 92, 246, 0.18)",
    border: "1px solid rgba(139, 92, 246, 0.45)",
    marginBottom: "24px",
  },
  roomCodeRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
  },
  copyButton: {
    padding: "9px 14px",
    borderRadius: "10px",
    border: "none",
    background: "#facc15",
    color: "#111",
    fontWeight: "bold",
    cursor: "pointer",
  },
  copyMessage: {
    margin: "8px 0 0",
    color: "#a7f3d0",
    fontSize: "14px",
  },
  smallText: {
    margin: "10px 0",
    color: "#cfc7ff",
    fontSize: "14px",
  },
  nameRuleText: {
    margin: "8px 0 0",
    color: "#cfc7ff",
    fontSize: "12px",
  },
  roomCode: {
    margin: "8px 0",
    letterSpacing: "2px",
  },
  inputGroup: {
    textAlign: "left",
    marginBottom: "24px",
  },
  label: {
    display: "block",
    marginBottom: "8px",
    color: "#ffffff",
    fontWeight: "bold",
  },
  input: {
    width: "100%",
    padding: "14px",
    borderRadius: "10px",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    background: "rgba(0, 0, 0, 0.35)",
    color: "white",
    fontSize: "16px",
    outline: "none",
    boxSizing: "border-box",
  },
  button: {
    width: "100%",
    padding: "14px",
    borderRadius: "10px",
    border: "none",
    background: "#8b5cf6",
    color: "white",
    fontSize: "16px",
    fontWeight: "bold",
    cursor: "pointer",
    marginBottom: "14px",
  },
  secondaryButton: {
    width: "100%",
    padding: "14px",
    borderRadius: "10px",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    background: "rgba(255, 255, 255, 0.08)",
    color: "white",
    fontSize: "16px",
    fontWeight: "bold",
    cursor: "pointer",
    marginBottom: "14px",
  },
  backButton: {
    background: "transparent",
    border: "none",
    color: "#cfc7ff",
    cursor: "pointer",
    fontSize: "14px",
    marginTop: "8px",
  },
  section: {
    textAlign: "left",
    marginBottom: "26px",
    padding: "18px",
    borderRadius: "14px",
    background: "rgba(0, 0, 0, 0.25)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
  },
  sectionTitle: {
    marginTop: 0,
    marginBottom: "14px",
    fontSize: "20px",
  },
  roleName: {
    fontSize: "38px",
    textAlign: "center",
    color: "#facc15",
    letterSpacing: "2px",
  },
  playerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px",
    borderRadius: "10px",
    background: "rgba(255, 255, 255, 0.08)",
    marginBottom: "10px",
  },
  badgeGroup: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  hostBadge: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#f59e0b",
    color: "#111",
    fontSize: "12px",
    fontWeight: "bold",
  },
  playerBadge: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#38bdf8",
    color: "#111",
    fontSize: "12px",
    fontWeight: "bold",
  },
  aliveBadge: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#22c55e",
    color: "#111",
    fontSize: "12px",
    fontWeight: "bold",
  },
  deadBadge: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#ef4444",
    color: "#111",
    fontSize: "12px",
    fontWeight: "bold",
  },
  disconnectedBadge: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#f97316",
    color: "#111",
    fontSize: "12px",
    fontWeight: "bold",
  },
  goneBadge: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#a855f7",
    color: "#fff",
    fontSize: "12px",
    fontWeight: "bold",
  },
  roleBadge: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#facc15",
    color: "#111",
    fontSize: "12px",
    fontWeight: "bold",
  },
  roomBadge: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: "#14b8a6",
    color: "#111",
    fontSize: "12px",
    fontWeight: "bold",
  },
  settingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 0",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  },
  select: {
    padding: "8px",
    borderRadius: "8px",
    background: "#111",
    color: "white",
    border: "1px solid rgba(255, 255, 255, 0.25)",
  },
  numberInput: {
    width: "70px",
    padding: "8px",
    borderRadius: "8px",
    background: "#111",
    color: "white",
    border: "1px solid rgba(255, 255, 255, 0.25)",
  },
  waitingText: {
    color: "#cfc7ff",
    fontWeight: "bold",
    marginBottom: "16px",
  },
  announcementBox: {
    padding: "18px",
    borderRadius: "14px",
    background: "rgba(250, 204, 21, 0.12)",
    border: "1px solid rgba(250, 204, 21, 0.45)",
    color: "#fff7cc",
    fontSize: "20px",
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: "22px",
  },
  systemBox: {
    padding: "14px",
    borderRadius: "14px",
    background: "rgba(168, 85, 247, 0.14)",
    border: "1px solid rgba(168, 85, 247, 0.4)",
    marginBottom: "22px",
    textAlign: "left",
  },
  systemMessage: {
    margin: "6px 0",
    color: "#f5d0fe",
    fontSize: "14px",
  },
  circleSection: {
    textAlign: "left",
    marginBottom: "26px",
    padding: "18px",
    borderRadius: "14px",
    background: "rgba(20, 184, 166, 0.12)",
    border: "1px solid rgba(20, 184, 166, 0.4)",
  },
  circleBoard: {
    position: "relative",
    width: "520px",
    height: "520px",
    margin: "30px auto",
    borderRadius: "50%",
    border: "2px dashed rgba(20, 184, 166, 0.45)",
    background: "rgba(0, 0, 0, 0.22)",
  },
  circleCenter: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: "120px",
    height: "120px",
    borderRadius: "50%",
    background: "rgba(139, 92, 246, 0.25)",
    border: "1px solid rgba(139, 92, 246, 0.55)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    color: "white",
    textAlign: "center",
  },
  circleRoom: {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    width: "112px",
    minHeight: "68px",
    padding: "9px",
    borderRadius: "14px",
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    textAlign: "center",
    fontSize: "13px",
  },
  circleRoomButton: {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    width: "116px",
    minHeight: "72px",
    padding: "9px",
    borderRadius: "14px",
    background: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    color: "white",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    textAlign: "center",
    fontSize: "13px",
  },
  selectedCircleRoom: {
    background: "rgba(139, 92, 246, 0.75)",
    border: "1px solid #c4b5fd",
  },
  circleRoomDead: {
    background: "rgba(239, 68, 68, 0.2)",
    border: "1px solid rgba(239, 68, 68, 0.65)",
  },
  circleRoomGone: {
    background: "rgba(168, 85, 247, 0.22)",
    border: "1px solid rgba(168, 85, 247, 0.65)",
  },
  circleRoomDisconnected: {
    background: "rgba(249, 115, 22, 0.22)",
    border: "1px solid rgba(249, 115, 22, 0.65)",
  },
  ruleBox: {
    padding: "14px",
    borderRadius: "14px",
    background: "rgba(59, 130, 246, 0.13)",
    border: "1px solid rgba(59, 130, 246, 0.4)",
    marginBottom: "22px",
    color: "#dbeafe",
    textAlign: "left",
  },
  nightImageBox: {
    padding: "40px",
    borderRadius: "18px",
    background:
      "linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.8))",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    marginBottom: "24px",
    textAlign: "center",
  },
  actionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
  },
  actionButton: {
    padding: "14px",
    borderRadius: "10px",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    background: "rgba(255, 255, 255, 0.08)",
    color: "white",
    fontSize: "15px",
    fontWeight: "bold",
    cursor: "pointer",
    minHeight: "76px",
  },
  targetButtonContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    lineHeight: "1.2",
  },
  selectedButton: {
    background: "#8b5cf6",
    border: "1px solid #c4b5fd",
  },
  disabledRoomButton: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  timeControlRow: {
    display: "flex",
    gap: "12px",
    justifyContent: "center",
    marginBottom: "16px",
  },
  smallButton: {
    padding: "10px 18px",
    borderRadius: "10px",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    background: "rgba(255, 255, 255, 0.08)",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
  },
  chatBox: {
    textAlign: "left",
    marginBottom: "26px",
    padding: "18px",
    borderRadius: "14px",
    background: "rgba(0, 0, 0, 0.25)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
  },
  chatMessages: {
    height: "180px",
    overflowY: "auto",
    padding: "12px",
    borderRadius: "10px",
    background: "rgba(0, 0, 0, 0.35)",
    marginBottom: "12px",
  },
  chatMessage: {
    marginBottom: "10px",
    color: "white",
  },
  chatInputRow: {
    display: "flex",
    gap: "10px",
  },
  chatInput: {
    flex: 1,
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    background: "rgba(0, 0, 0, 0.35)",
    color: "white",
    fontSize: "15px",
    outline: "none",
  },
  sendButton: {
    padding: "12px 18px",
    borderRadius: "10px",
    border: "none",
    background: "#8b5cf6",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
  },
  deadNotice: {
    color: "#fca5a5",
    fontWeight: "bold",
  },
  finalRevealCard: {
    padding: "14px",
    borderRadius: "12px",
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    marginBottom: "12px",
    lineHeight: "1.7",
  },
};

export default App;