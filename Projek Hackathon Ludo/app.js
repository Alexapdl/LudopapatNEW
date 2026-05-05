/* ============================================================
   LUDO PAPAT — Game Engine, Wallet Sim & Transaction Logger
   ============================================================ */

// ===================== CONSTANTS =====================

const BOARD_SIZE = 15;
let ENTRY_FEE = 1.00;
const STARTING_BALANCE = 50.0;
const MAX_CONSECUTIVE_SIXES = 2; // Reduced for faster play
const PLATFORM_FEE_PERCENT = 0.10; // 10% platform fee
const TOKENS_PER_PLAYER = 2;
const TURN_TIME_MS = 7000; // 7 seconds per turn

// Main path: 52 cells, clockwise. [row, col]
// Player 0 (RED) starts at index 0, Player 1 (GREEN) at 13, Player 2 (YELLOW) at 26, Player 3 (BLUE) at 39
const PATH = [
    [13,6],[12,6],[11,6],[10,6],[9,6],           // 0-4:   RED start area, going UP
    [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],          // 5-10:  left arm bottom row, going LEFT
    [7,0],                                         // 11:    left arm corner
    [6,0],                                         // 12:    left arm top-left corner
    [6,1],[6,2],[6,3],[6,4],[6,5],                // 13-17: GREEN start area, going RIGHT
    [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],          // 18-23: top arm left col, going UP
    [0,7],                                         // 24:    top arm corner
    [0,8],                                         // 25:    top arm top-right corner
    [1,8],[2,8],[3,8],[4,8],[5,8],                // 26-30: YELLOW start area, going DOWN
    [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],     // 31-36: right arm top row, going RIGHT
    [7,14],                                        // 37:    right arm corner
    [8,14],                                        // 38:    right arm bottom-right corner
    [8,13],[8,12],[8,11],[8,10],[8,9],            // 39-43: BLUE start area, going LEFT
    [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],     // 44-49: bottom arm right col, going DOWN
    [14,7],                                        // 50:    bottom arm corner
    [14,6],                                        // 51:    bottom arm bottom-left corner
];

// Home columns: 6 cells per player leading to center
const HOME_COLUMNS = [
    [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],    // RED:    bottom arm center, going UP
    [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],        // GREEN:  left arm center, going RIGHT
    [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],        // YELLOW: top arm center, going DOWN
    [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],    // BLUE:   right arm center, going LEFT
];

// Base token positions (where tokens sit when in base)
const BASE_POSITIONS = [
    [[10,1],[10,4],[13,1],[13,4]],  // RED     (bottom-left)
    [[1,1],[1,4],[4,1],[4,4]],      // GREEN   (top-left)
    [[1,10],[1,13],[4,10],[4,13]],  // YELLOW  (top-right)
    [[10,10],[10,13],[13,10],[13,13]], // BLUE  (bottom-right)
];

// Player configurations
const PLAYERS = [
    { name: 'You',       color: 'red',    hex: '#FF4455', isAI: false, startPos: 0  },
    { name: 'Bot Alpha', color: 'green',  hex: '#44DD66', isAI: true,  startPos: 13 },
    { name: 'Bot Beta',  color: 'yellow', hex: '#FFD700', isAI: true,  startPos: 26 },
    { name: 'Bot Gamma', color: 'blue',   hex: '#4499FF', isAI: true,  startPos: 39 },
];

// Safe positions (star cells) — tokens here can't be captured
const SAFE_POSITIONS = [0, 8, 13, 21, 26, 34, 39, 47];

// Dice dot patterns for a 3x3 grid [row, col]
const DICE_DOTS = {
    1: [[1,1]],
    2: [[0,2],[2,0]],
    3: [[0,2],[1,1],[2,0]],
    4: [[0,0],[0,2],[2,0],[2,2]],
    5: [[0,0],[0,2],[1,1],[2,0],[2,2]],
    6: [[0,0],[1,0],[2,0],[0,2],[1,2],[2,2]],
};

// Build path lookup: "row,col" -> path index
const PATH_LOOKUP = {};
PATH.forEach((pos, idx) => { PATH_LOOKUP[`${pos[0]},${pos[1]}`] = idx; });


// ===================== GAME STATE =====================

let gs = {
    phase: 'landing',       // landing | game | ended
    wallet: { address: null, connected: false, points: 0 },
    currentRoomType: null,
    players: [],
    currentPlayer: 0,
    prizePool: 0,
    diceValue: 0,
    isRolling: false,
    isMoving: false,
    awaitingSelection: false,
    validMoves: [],
    consecutiveSixes: 0,
    transactions: [],
    txCount: 0,
    totalRolls: 0,
    gameOver: false,
    messageTimer: null,
    turnTimer: null,
    timeLeft: 0
};

function resetPlayers() {
    gs.players = PLAYERS.map(p => ({
        ...p,
        balance: STARTING_BALANCE,
        tokens: Array.from({ length: TOKENS_PER_PLAYER }, () => ({
            state: 'base', 
            position: -1
        }))
    }));
}


// ===================== UTILITIES =====================

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function genB58(len) { let r=''; for(let i=0;i<len;i++) r+=BASE58[Math.floor(Math.random()*58)]; return r; }
function fmtUSDT(v) { return '$' + v.toFixed(2); }
function truncHash(h) { return h.slice(0,8) + '...' + h.slice(-8); }
function truncAddr(a) { return a.slice(0,4) + '...' + a.slice(-4); }


// ===================== WALLET SIMULATION =====================

function connectWallet() {
    if (gs.wallet.connected) return;

    const addr = genB58(44);
    gs.wallet.address = addr;
    gs.wallet.connected = true;
    gs.phase = 'room-select';

    // Hide landing, show room selection
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('room-selection').classList.remove('hidden');

    // Update room selection wallet display
    document.querySelector('#room-wallet-address .addr-text').textContent = truncAddr(addr);
    document.getElementById('room-wallet-balance').textContent = fmtUSDT(STARTING_BALANCE);
}

// Room type configs:
//   fee         → amount deducted from player's wallet (real entry cost)
//   sponsorPrize → extra prize injected by sponsor (free money into prize pool)
//   ticketName  → label shown in transaction log
const ROOM_CONFIGS = {
    //   fee             → amount deducted from player wallet (entry ticket)
    //   sponsorPrize    → prize money injected by sponsor
    //   prizeFromEntries→ if true, entry fees also added to prize pool (duel mode)
    //                     if false, entry fees go to platform revenue only (tournament mode)
    //   ticketName      → label shown in transaction log
    'casual':     { fee: 0,    sponsorPrize: 0,    prizeFromEntries: false, label: 'Casual Room', ticketName: 'Free'        },
    'pro':        { fee: 1.00, sponsorPrize: 0,    prizeFromEntries: true,  label: 'Pro Room',    ticketName: 'Ludo Pass'   }, // Pure duel
    'tournament': { fee: 2.00, sponsorPrize: 5.00, prizeFromEntries: true,  label: 'Tournament',  ticketName: 'Gold Ticket' }, // Sponsor-backed + Entry fees
};

// Show an error toast on the room-selection page
function showRoomError(msg) {
    let toast = document.getElementById('room-error-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'room-error-toast';
        toast.style.cssText = [
            'position:fixed', 'bottom:32px', 'left:50%', 'transform:translateX(-50%)',
            'background:rgba(255,68,85,0.95)', 'color:#fff', 'padding:14px 28px',
            'border-radius:12px', 'font-family:Outfit,sans-serif', 'font-weight:700',
            'font-size:15px', 'z-index:9999', 'box-shadow:0 8px 30px rgba(255,68,85,0.4)',
            'backdrop-filter:blur(10px)', 'letter-spacing:0.3px'
        ].join(';');
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
        toast.style.transition = 'opacity 0.5s';
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; toast.style.transition = ''; }, 500);
    }, 2800);
}

function selectRoom(roomType, legacySponsor = 0) {
    // Support both new string-based room types and legacy numeric calls
    let fee, sponsorPrize, roomLabel, ticketName, prizeFromEntries;
    if (typeof roomType === 'string' && ROOM_CONFIGS[roomType]) {
        const cfg = ROOM_CONFIGS[roomType];
        fee              = cfg.fee;
        sponsorPrize     = cfg.sponsorPrize;
        roomLabel        = cfg.label;
        ticketName       = cfg.ticketName;
        prizeFromEntries = cfg.prizeFromEntries;
    } else {
        // Legacy numeric path (e.g. selectRoom(1.00))
        fee              = Number(roomType) || 0;
        sponsorPrize     = legacySponsor;
        roomLabel        = 'Room';
        ticketName       = fee > 0 ? 'Ticket' : 'Free';
        prizeFromEntries = true; // legacy: treat entries as prize pool
    }

    // ── Balance check ───────────────────────────────────────────────
    // Use STARTING_BALANCE as the current wallet balance reference
    // (gs.players hasn't been initialised yet at this point)
    const currentBalance = gs.players.length > 0
        ? gs.players[0].balance
        : STARTING_BALANCE;

    if (fee > 0 && currentBalance < fee) {
        showRoomError(
            `⚠️ Saldo tidak cukup! Butuh ${fmtUSDT(fee)} — kamu punya ${fmtUSDT(currentBalance)}.`
        );
        return; // abort — do NOT hide room selection or start game
    }
    // ────────────────────────────────────────────────────────────────

    ENTRY_FEE = fee;
    gs.phase = 'game';
    gs.currentRoomType = typeof roomType === 'string' ? roomType : 'legacy';

    // Hide room selection, show game
    document.getElementById('room-selection').classList.add('hidden');
    document.getElementById('game-page').classList.remove('hidden');

    // Update roll cost label
    document.getElementById('roll-cost-label').textContent = '(Free)';

    // Update wallet display in game header
    document.querySelector('#wallet-address .addr-text').textContent = truncAddr(gs.wallet.address);

    // Init game state (resets players with STARTING_BALANCE)
    resetPlayers();

    // ── Deduct entry fee from player's wallet ──
    gs.players[0].balance -= ENTRY_FEE;

    // ── Build prize pool ──
    // Duel mode (prizeFromEntries=true) : prize pool = all 4 entry fees + sponsor
    // Tournament mode (prizeFromEntries=false): entry fees → platform revenue,
    //                                           prize pool = sponsor money only
    gs.prizePool = prizeFromEntries
        ? (ENTRY_FEE * 4) + sponsorPrize
        : sponsorPrize;

    // Sync both balance displays
    document.getElementById('wallet-balance').textContent       = fmtUSDT(gs.players[0].balance);
    document.getElementById('room-wallet-balance').textContent  = fmtUSDT(gs.players[0].balance);
    
    // Sync point displays
    document.getElementById('wallet-points').textContent      = '🌟 ' + gs.wallet.points;
    document.getElementById('room-wallet-points').textContent = '🌟 ' + gs.wallet.points;

    // Add Room Entry Transaction to log
    const txHash = genB58(88);
    gs.transactions.unshift({
        id: gs.txCount++,
        time: new Date(),
        pIdx: 0,
        playerName: roomLabel,
        color: 'white',
        dice: ticketName,
        amount: ENTRY_FEE,
        hash: txHash,
        bal: gs.players[0].balance,
        isEntry: true
    });
    renderTxEntry(gs.transactions[0]);

    initGame();
}


// ===================== BOARD GENERATION =====================

function generateBoard() {
    const board = document.getElementById('ludo-board');
    board.innerHTML = '';

    for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = r;
            cell.dataset.col = c;

            const info = classifyCell(r, c);
            info.classes.forEach(cls => cell.classList.add(cls));

            if (info.content) cell.innerHTML = info.content;

            board.appendChild(cell);
        }
    }
}

function classifyCell(r, c) {
    const classes = [];
    let content = '';

    // ---- Bases ----
    const base = getBase(r, c);
    if (base !== null) {
        classes.push('cell-base', `cell-base-${PLAYERS[base.player].color}`);
        if (base.inner) classes.push('cell-base-inner');
        if (base.slot)  classes.push('cell-base-slot');
        return { classes, content };
    }

    // ---- Main path ----
    const pathKey = `${r},${c}`;
    if (PATH_LOOKUP[pathKey] !== undefined) {
        const idx = PATH_LOOKUP[pathKey];
        classes.push('cell-path');

        // Start position?
        for (let p = 0; p < 4; p++) {
            if (idx === PLAYERS[p].startPos) {
                classes.push('cell-start', `cell-start-${PLAYERS[p].color}`);
                const arrows = ['↑','→','↓','←'];
                content = `<span class="arrow">${arrows[p]}</span>`;
            }
        }

        // Safe/star position?
        if (SAFE_POSITIONS.includes(idx) && !classes.some(c => c.startsWith('cell-start'))) {
            classes.push('cell-safe');
            content = '<span class="star">★</span>';
        }

        return { classes, content };
    }

    // ---- Home columns ----
    for (let p = 0; p < 4; p++) {
        for (let h = 0; h < 6; h++) {
            if (HOME_COLUMNS[p][h][0] === r && HOME_COLUMNS[p][h][1] === c) {
                classes.push('cell-home', `cell-home-${PLAYERS[p].color}`);
                return { classes, content };
            }
        }
    }

    // ---- Center 3x3 ----
    if (r >= 6 && r <= 8 && c >= 6 && c <= 8) {
        classes.push('cell-center');
        if (r === 7 && c === 7) { classes.push('cell-center-home'); content = '<span style="font-size:14px">🏠</span>'; }
        else if (r === 8 && c === 7) classes.push('cell-center-red');
        else if (r === 7 && c === 6) classes.push('cell-center-green');
        else if (r === 6 && c === 7) classes.push('cell-center-yellow');
        else if (r === 7 && c === 8) classes.push('cell-center-blue');
        else if (r === 6 && c === 6) classes.push('cell-center-tl');
        else if (r === 6 && c === 8) classes.push('cell-center-tr');
        else if (r === 8 && c === 6) classes.push('cell-center-bl');
        else if (r === 8 && c === 8) classes.push('cell-center-br');
        return { classes, content };
    }

    return { classes, content };
}

function getBase(r, c) {
    const bases = [
        { player: 0, rMin: 9, rMax: 14, cMin: 0, cMax: 5 },  // RED bottom-left
        { player: 1, rMin: 0, rMax: 5,  cMin: 0, cMax: 5 },  // GREEN top-left
        { player: 2, rMin: 0, rMax: 5,  cMin: 9, cMax: 14 }, // YELLOW top-right
        { player: 3, rMin: 9, rMax: 14, cMin: 9, cMax: 14 }, // BLUE bottom-right
    ];

    for (const b of bases) {
        if (r >= b.rMin && r <= b.rMax && c >= b.cMin && c <= b.cMax) {
            const inner = r >= b.rMin+1 && r <= b.rMax-1 && c >= b.cMin+1 && c <= b.cMax-1;
            const slot = BASE_POSITIONS[b.player].some(bp => bp[0]===r && bp[1]===c);
            return { player: b.player, inner, slot };
        }
    }
    return null;
}


// ===================== TOKEN RENDERING =====================

function createTokens() {
    const layer = document.getElementById('tokens-layer');
    layer.innerHTML = '';

    for (let p = 0; p < 4; p++) {
        for (let t = 0; t < TOKENS_PER_PLAYER; t++) {
            const el = document.createElement('div');
            el.id = `token-${p}-${t}`;
            el.className = `token token-${PLAYERS[p].color}`;
            el.dataset.player = p;
            el.dataset.token = t;
            el.addEventListener('click', () => onTokenClick(p, t));
            layer.appendChild(el);
        }
    }
    refreshAllTokens();
}

function refreshAllTokens() {
    for (let p = 0; p < 4; p++)
        for (let t = 0; t < TOKENS_PER_PLAYER; t++)
            positionToken(p, t);
}

function positionToken(pIdx, tIdx) {
    const el = document.getElementById(`token-${pIdx}-${tIdx}`);
    if (!el) return;
    const tok = gs.players[pIdx].tokens[tIdx];
    let row, col;

    if (tok.state === 'base') {
        [row, col] = BASE_POSITIONS[pIdx][tIdx];
    } else if (tok.state === 'path') {
        [row, col] = PATH[tok.position];
    } else if (tok.state === 'homeColumn') {
        [row, col] = HOME_COLUMNS[pIdx][tok.position];
    } else { // home
        row = 7; col = 7;
    }

    const wrapper = document.getElementById('board-wrapper');
    const cellW = wrapper.clientWidth / 15;
    const cellH = wrapper.clientHeight / 15;

    // Offset for stacking multiple tokens on same cell
    const off = getStackOffset(pIdx, tIdx, row, col);

    el.style.left = `${col * cellW + cellW / 2 + off.x}px`;
    el.style.top  = `${row * cellH + cellH / 2 + off.y}px`;

    el.classList.toggle('token-home', tok.state === 'home');
}

function getStackOffset(pIdx, tIdx, row, col) {
    const here = [];
    for (let p = 0; p < 4; p++) {
        for (let t = 0; t < TOKENS_PER_PLAYER; t++) {
            const tk = gs.players[p].tokens[t];
            let tr, tc;
            if (tk.state === 'base')       { [tr,tc] = BASE_POSITIONS[p][t]; }
            else if (tk.state === 'path')  { [tr,tc] = PATH[tk.position]; }
            else if (tk.state === 'homeColumn') { [tr,tc] = HOME_COLUMNS[p][tk.position]; }
            else { tr=7; tc=7; }
            if (tr === row && tc === col) here.push({p, t});
        }
    }
    if (here.length <= 1) return { x: 0, y: 0 };
    const i = here.findIndex(h => h.p === pIdx && h.t === tIdx);
    const offsets = [{x:-5,y:-5},{x:5,y:-5},{x:-5,y:5},{x:5,y:5}];
    return offsets[i % 4];
}


// ===================== DICE =====================

function renderDiceFace(val) {
    const face = document.getElementById('dice-face');
    face.innerHTML = '';
    const dots = DICE_DOTS[val] || [];

    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const cell = document.createElement('div');
            cell.className = 'dice-cell';
            if (dots.some(d => d[0]===r && d[1]===c)) {
                const dot = document.createElement('div');
                dot.className = 'dice-dot';
                cell.appendChild(dot);
            }
            face.appendChild(cell);
        }
    }
}

async function animateDice(finalVal) {
    const dice = document.getElementById('dice');
    dice.classList.add('rolling');

    for (let i = 0; i < 8; i++) {
        renderDiceFace(Math.floor(Math.random() * 6) + 1);
        await sleep(70);
    }

    dice.classList.remove('rolling');
    renderDiceFace(finalVal);
    await sleep(300);
}


// ===================== GAME LOGIC =====================

function initGame() {
    generateBoard();
    createTokens();
    updateAllUI();
    startTurn();
}

function startTurn() {
    if (gs.gameOver) return;

    const player = gs.players[gs.currentPlayer];
    updateTurnUI();
    startTimer();

    if (player.isAI) {
        document.getElementById('roll-btn').disabled = true;
        const delay = 800 + Math.random() * 800;
        setTimeout(() => {
            if (gs.currentPlayer === gs.players.indexOf(player)) rollDice();
        }, delay);
    } else {
        document.getElementById('roll-btn').disabled = false;
    }
}

function startTimer() {
    stopTimer();
    gs.timeLeft = TURN_TIME_MS;
    updateTimerUI();
    
    gs.turnTimer = setInterval(() => {
        gs.timeLeft -= 100;
        updateTimerUI();
        
        if (gs.timeLeft <= 0) {
            stopTimer();
            if (gs.currentPlayer === 0) { // If it's human's turn and time's up
                if (gs.awaitingSelection) {
                    // Auto pick move if they took too long
                    const move = aiPickMove(gs.validMoves);
                    gs.awaitingSelection = false;
                    clearHighlights();
                    hideMessage();
                    executeMove(move).then(() => afterMove(gs.diceValue));
                } else if (!gs.isRolling && !gs.isMoving) {
                    // Auto roll
                    rollDice();
                }
            }
        }
    }, 100);
}

function stopTimer() {
    if (gs.turnTimer) {
        clearInterval(gs.turnTimer);
        gs.turnTimer = null;
    }
}

function updateTimerUI() {
    const fill = document.getElementById('timer-fill');
    if (fill) {
        let pct = (gs.timeLeft / TURN_TIME_MS) * 100;
        fill.style.width = `${Math.max(0, pct)}%`;
        if (pct < 30) fill.style.background = 'var(--red)';
        else if (pct < 60) fill.style.background = 'var(--yellow)';
        else fill.style.background = 'var(--green)';
    }
}

async function rollDice() {
    if (gs.isRolling || gs.isMoving || gs.awaitingSelection || gs.gameOver) return;

    const player = gs.players[gs.currentPlayer];

    stopTimer();
    gs.isRolling = true;
    document.getElementById('roll-btn').disabled = true;

    // Roll
    const val = Math.floor(Math.random() * 6) + 1;
    gs.diceValue = val;
    gs.totalRolls++;

    // Animate
    await animateDice(val);

    // Log transaction (Free states)
    addTransaction(gs.currentPlayer, val);
    updateBalancesUI();

    gs.isRolling = false;

    // Valid moves
    const moves = getValidMoves(gs.currentPlayer, val);
    gs.validMoves = moves;

    if (moves.length === 0) {
        showMessage('No valid moves!');
        await sleep(800);
        afterMove(val);
        return;
    }

    if (moves.length === 1) {
        await executeMove(moves[0]);
        afterMove(val);
        return;
    }

    // Multiple moves
    if (player.isAI) {
        const move = aiPickMove(moves);
        await executeMove(move);
        afterMove(val);
    } else {
        // Player must choose
        gs.awaitingSelection = true;
        highlightTokens(moves);
        showMessage('Select a token to move');
        startTimer(); // Restart timer for selection
    }
}

function getValidMoves(pIdx, dice) {
    const player = gs.players[pIdx];
    const moves = [];

    for (let t = 0; t < TOKENS_PER_PLAYER; t++) {
        const tok = player.tokens[t];

        if (tok.state === 'base') {
            // Action Ludo: Any roll exits base!
            moves.push({ tokenIdx: t, type: 'exit' });
        } else if (tok.state === 'path') {
            const dist = (tok.position - PLAYERS[pIdx].startPos + 52) % 52;
            const newDist = dist + dice;

            if (newDist <= 51) {
                const newPos = (tok.position + dice) % 52;
                moves.push({ tokenIdx: t, type: 'path', newPos });
            } else {
                const homePos = newDist - 52;
                if (homePos <= 5) {
                    moves.push({ tokenIdx: t, type: 'enterHome', homePos });
                }
            }
        } else if (tok.state === 'homeColumn') {
            const newHP = tok.position + dice;
            if (newHP <= 5) {
                moves.push({ tokenIdx: t, type: 'moveHome', newHomePos: newHP });
            }
        }
        // 'home' — finished, skip
    }

    return moves;
}

async function executeMove(move) {
    gs.isMoving = true;
    const pIdx = gs.currentPlayer;
    const tok = gs.players[pIdx].tokens[move.tokenIdx];

    switch (move.type) {
        case 'exit': {
            tok.state = 'path';
            tok.position = PLAYERS[pIdx].startPos;
            positionToken(pIdx, move.tokenIdx);
            await sleep(200);
            doCapture(pIdx, tok.position);
            break;
        }

        case 'path': {
            let cur = tok.position;
            for (let i = 0; i < gs.diceValue; i++) {
                cur = (cur + 1) % 52;
                tok.position = cur;
                positionToken(pIdx, move.tokenIdx);
                await sleep(100);
            }
            doCapture(pIdx, tok.position);
            break;
        }

        case 'enterHome': {
            // Walk remaining path steps
            const startPos = PLAYERS[pIdx].startPos;
            const homeEntry = (startPos - 1 + 52) % 52;
            let cur = tok.position;
            let safety = 0;
            while (cur !== homeEntry && safety < 52) {
                cur = (cur + 1) % 52;
                tok.position = cur;
                tok.state = 'path';
                positionToken(pIdx, move.tokenIdx);
                await sleep(100);
                safety++;
            }
            // Enter home column
            tok.state = 'homeColumn';
            for (let h = 0; h <= move.homePos; h++) {
                tok.position = h;
                positionToken(pIdx, move.tokenIdx);
                await sleep(100);
            }
            if (move.homePos >= 5) {
                tok.state = 'home';
                positionToken(pIdx, move.tokenIdx);
                if (checkWin(pIdx)) { handleWin(pIdx); return; }
            }
            break;
        }

        case 'moveHome': {
            for (let h = tok.position + 1; h <= move.newHomePos; h++) {
                tok.position = h;
                positionToken(pIdx, move.tokenIdx);
                await sleep(100);
            }
            if (move.newHomePos >= 5) {
                tok.state = 'home';
                positionToken(pIdx, move.tokenIdx);
                if (checkWin(pIdx)) { handleWin(pIdx); return; }
            }
            break;
        }
    }

    gs.isMoving = false;
    refreshAllTokens();
    updatePlayerCardsUI();
}

function doCapture(attackerIdx, pathPos) {
    if (SAFE_POSITIONS.includes(pathPos)) return; // safe cell

    for (let p = 0; p < 4; p++) {
        if (p === attackerIdx) continue;
        for (let t = 0; t < TOKENS_PER_PLAYER; t++) {
            const tok = gs.players[p].tokens[t];
            if (tok.state === 'path' && tok.position === pathPos) {
                tok.state = 'base';
                tok.position = -1;
                positionToken(p, t);
                showMessage(`${PLAYERS[attackerIdx].name} captured ${PLAYERS[p].name}!`);
            }
        }
    }
}

function checkWin(pIdx) {
    return gs.players[pIdx].tokens.every(t => t.state === 'home');
}

function afterMove(diceVal) {
    if (gs.gameOver) return;

    if (diceVal === 6) {
        gs.consecutiveSixes++;
        if (gs.consecutiveSixes >= MAX_CONSECUTIVE_SIXES) {
            showMessage('Max rolls! Turn over.');
            gs.consecutiveSixes = 0;
            setTimeout(() => nextTurn(), 800);
        } else {
            showMessage('Rolled 6! Roll again! 🎉');
            setTimeout(() => startTurn(), 600);
        }
    } else {
        gs.consecutiveSixes = 0;
        nextTurn();
    }
}

function nextTurn() {
    if (gs.gameOver) return;
    gs.currentPlayer = (gs.currentPlayer + 1) % 4;
    gs.consecutiveSixes = 0;
    setTimeout(() => startTurn(), 400);
}

function handleWin(pIdx) {
    gs.gameOver = true;
    gs.phase = 'ended';

    const winner = gs.players[pIdx];
    let prizeLabel = 'Prize Pool Won';
    let prizeDisplay = '';

    if (gs.currentRoomType === 'casual') {
        // Casual room: award points
        const pointsWon = 50;
        if (pIdx === 0) gs.wallet.points += pointsWon; // give to human player
        
        // Ensure UI updates
        document.getElementById('wallet-points').textContent      = '🌟 ' + gs.wallet.points;
        document.getElementById('room-wallet-points').textContent = '🌟 ' + gs.wallet.points;
        
        prizeLabel   = 'Ludo Points Earned';
        prizeDisplay = `🌟 ${pointsWon} Points`;
    } else {
        // Paid/Tournament room: award USDT
        const platformFee = gs.prizePool * PLATFORM_FEE_PERCENT;
        const winnerPrize = gs.prizePool - platformFee;
        winner.balance += winnerPrize;
        
        prizeDisplay = fmtUSDT(winnerPrize);
    }

    // Modal
    document.getElementById('winner-title').textContent =
        pIdx === 0 ? '🎉 You Win!' : `${winner.name} Wins!`;
    document.getElementById('wp-label-dynamic').textContent = prizeLabel;
    document.getElementById('winner-prize-value').textContent = prizeDisplay;
    document.getElementById('winner-total-tx').textContent = gs.txCount;
    document.getElementById('winner-total-rolls').textContent = gs.totalRolls;
    document.getElementById('winner-modal').classList.remove('hidden');

    createConfetti();
}


// ===================== TOKEN INTERACTION =====================

function onTokenClick(pIdx, tIdx) {
    if (!gs.awaitingSelection) return;
    if (pIdx !== gs.currentPlayer) return;

    const move = gs.validMoves.find(m => m.tokenIdx === tIdx);
    if (!move) return;

    gs.awaitingSelection = false;
    clearHighlights();
    hideMessage();

    executeMove(move).then(() => {
        afterMove(gs.diceValue);
    });
}

function highlightTokens(moves) {
    moves.forEach(m => {
        const el = document.getElementById(`token-${gs.currentPlayer}-${m.tokenIdx}`);
        if (el) el.classList.add('selectable');
    });
}

function clearHighlights() {
    document.querySelectorAll('.token.selectable').forEach(el => el.classList.remove('selectable'));
}


// ===================== AI =====================

function aiPickMove(moves) {
    // 1. Capture?
    for (const m of moves) {
        if (m.type === 'path') {
            for (let p = 0; p < 4; p++) {
                if (p === gs.currentPlayer) continue;
                for (let t = 0; t < TOKENS_PER_PLAYER; t++) {
                    const tk = gs.players[p].tokens[t];
                    if (tk.state === 'path' && tk.position === m.newPos) return m;
                }
            }
        }
    }

    // 2. Enter home?
    const enterHome = moves.find(m => m.type === 'enterHome');
    if (enterHome) return enterHome;

    // 3. Move in home column (prefer closer to home)?
    const homeMove = moves.filter(m => m.type === 'moveHome').sort((a,b) => b.newHomePos - a.newHomePos)[0];
    if (homeMove) return homeMove;

    // 4. Exit base?
    const exit = moves.find(m => m.type === 'exit');
    if (exit) return exit;

    // 5. Move farthest token
    let best = moves[0];
    let bestDist = -1;
    for (const m of moves) {
        if (m.type === 'path') {
            const tok = gs.players[gs.currentPlayer].tokens[m.tokenIdx];
            const dist = (tok.position - PLAYERS[gs.currentPlayer].startPos + 52) % 52;
            if (dist > bestDist) { bestDist = dist; best = m; }
        }
    }
    return best;
}


// ===================== TRANSACTIONS =====================

function addTransaction(pIdx, diceVal) {
    const player = gs.players[pIdx];
    const txHash = genB58(88);
    const now = new Date();

    const tx = {
        id: gs.txCount++,
        time: now,
        pIdx,
        playerName: player.name,
        color: player.color,
        dice: diceVal,
        amount: 0, // In-game rolls are free now
        hash: txHash,
        bal: player.balance,
        isEntry: false
    };

    gs.transactions.unshift(tx);
    renderTxEntry(tx);

    // Update count
    document.getElementById('tx-count').textContent = `${gs.txCount} txns`;
}

function renderTxEntry(tx) {
    const list = document.getElementById('transaction-list');

    // Remove empty message
    const empty = list.querySelector('.tx-empty');
    if (empty) empty.remove();

    const el = document.createElement('div');
    el.className = 'tx-entry';
    const time = tx.time.toLocaleTimeString();

    el.innerHTML = `
        <div class="tx-header">
            <span class="tx-player" style="color: var(--${tx.color})">${tx.playerName}</span>
            <span class="tx-time">${time}</span>
        </div>
        <div class="tx-body">
            <span class="tx-dice">${tx.isEntry ? '🎟️ Bought Entry Ticket' : `🎲 Rolled ${tx.dice}`}</span>
            <span class="tx-amount" style="color: ${tx.isEntry ? 'var(--red)' : 'var(--text-muted)'}">${tx.amount === 0 ? 'Cost: Free' : `-$${tx.amount.toFixed(2)}`}</span>
        </div>
        <div class="tx-hash-row">
            <span class="tx-hash">${truncHash(tx.hash)}</span>
            <span class="tx-status">✓ Confirmed</span>
        </div>
    `;

    list.insertBefore(el, list.firstChild);

    // Keep max 50 entries
    while (list.children.length > 50) {
        list.removeChild(list.lastChild);
    }
}


// ===================== UI UPDATES =====================

function updateAllUI() {
    updateBalancesUI();
    updatePlayerCardsUI();
    updateTurnUI();
    renderDiceFace(1);
}

function updateBalancesUI() {
    document.getElementById('wallet-balance').textContent = fmtUSDT(gs.players[0].balance);
    document.getElementById('prize-pool-value').textContent = fmtUSDT(gs.prizePool);
}

function updatePlayerCardsUI() {
    for (let p = 0; p < 4; p++) {
        const card = document.getElementById(`player-card-${p}`);
        const player = gs.players[p];

        card.classList.toggle('active', p === gs.currentPlayer);
        card.querySelector('.pc-balance').textContent = fmtUSDT(player.balance);

        const minis = card.querySelectorAll('.mini-tok');
        player.tokens.forEach((tok, i) => {
            minis[i].classList.toggle('on-board', tok.state === 'path' || tok.state === 'homeColumn');
            minis[i].classList.toggle('at-home', tok.state === 'home');
        });
    }
}

function updateTurnUI() {
    const player = gs.players[gs.currentPlayer];
    const ind = document.getElementById('turn-indicator');
    ind.textContent = player.isAI ? `${player.name}'s Turn...` : '🎲 Your Turn!';
    ind.style.color = `var(--${player.color})`;
    updatePlayerCardsUI();
}

function showMessage(text) {
    const el = document.getElementById('game-message');
    document.getElementById('message-text').textContent = text;
    el.classList.remove('hidden');
    if (gs.messageTimer) clearTimeout(gs.messageTimer);
    gs.messageTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

function hideMessage() {
    const el = document.getElementById('game-message');
    el.classList.add('hidden');
    if (gs.messageTimer) clearTimeout(gs.messageTimer);
}


// ===================== CONFETTI =====================

function createConfetti() {
    const container = document.getElementById('confetti-container');
    container.innerHTML = '';
    const colors = ['#FF4455','#44DD66','#FFD700','#4499FF','#9945FF','#14F195','#FF8C00'];

    for (let i = 0; i < 80; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.animationDelay = `${Math.random() * 3}s`;
        piece.style.animationDuration = `${2 + Math.random() * 2}s`;
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.width = `${6 + Math.random() * 8}px`;
        piece.style.height = `${6 + Math.random() * 8}px`;
        container.appendChild(piece);
    }
}


// ===================== SHOP & POINTS =====================

function openShop() {
    document.getElementById('shop-modal').classList.remove('hidden');
}

function closeShop() {
    document.getElementById('shop-modal').classList.add('hidden');
}

function buyItem(cost, itemName) {
    if (gs.wallet.points >= cost) {
        gs.wallet.points -= cost;
        document.getElementById('wallet-points').textContent      = '🌟 ' + gs.wallet.points;
        document.getElementById('room-wallet-points').textContent = '🌟 ' + gs.wallet.points;
        showRoomError(`✅ Berhasil membeli: ${itemName}!`); // Using existing toast logic but for success
        closeShop();
    } else {
        showRoomError(`⚠️ Poin kamu tidak cukup. Kurang ${cost - gs.wallet.points} 🌟.`);
    }
}


// ===================== WINDOW RESIZE =====================

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (gs.phase === 'game' || gs.phase === 'ended') {
            refreshAllTokens();
        }
    }, 150);
});


// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', () => {
    // Landing page is shown by default
    renderDiceFace(1);
});
