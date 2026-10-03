// DOM Elements
const setupPanel = document.getElementById('setup-panel');
const gameDashboard = document.getElementById('game-dashboard');
const setupForm = document.getElementById('setup-form');

// Constants
const RIG_RATE_HR = 5000;
const ROTATE_COST_HR = 150;
const SLIDE_COST_HR = 30;
const ROP_ROTATE = 90.0;
const ROP_SLIDE = 45.0;
const KOP = 2000;

// Game State
let game = {
    md: 0.0,
    tvd: -85.0,
    hd: 0.0,
    inc: 0.0,
    cost: 0.0,
    path_tvd: [-85.0],
    path_hd: [0.0],
    stand_length: 90.0,
    targets: [],
    motor_yield: 0.0,
    max_consec_slides: Infinity,
    penalty_amount: 0.0,
    current_consec_slides: 0,
    target_status: [],
    game_over: false,
    off_tvd: [],
    off_hd: []
};

let chartInstance = null;

// Generate Offset Well
function generateOffsetWell() {
    let tvd = -85.0;
    let hd = 150;
    let inc = 0;
    let path_tvd = [-85.0];
    let path_hd = [150];

    while (tvd < 2500) {
        tvd += 20;
        path_tvd.push(tvd);
        path_hd.push(hd);
    }

    let build_rate = 2.0 / 90.0;
    while (tvd < 12000) {
        let d_md = 10;
        inc += build_rate * d_md;
        if (inc > 45) inc = 45;

        let rad = inc * Math.PI / 180.0;
        let d_tvd = d_md * Math.cos(rad);
        let d_hd = d_md * Math.sin(rad);

        tvd += d_tvd;
        hd += d_hd;
        path_tvd.push(tvd);
        path_hd.push(hd);
    }
    return { path_tvd, path_hd };
}

// Check Collision
function checkCollision() {
    let min_dist = Infinity;
    for (let i = 0; i < game.off_tvd.length; i++) {
        let ot = game.off_tvd[i];
        let oh = game.off_hd[i];

        // Search window to improve perf and emulate python logic
        if (Math.abs(ot - game.tvd) < 600) {
            let dist = Math.sqrt(Math.pow(ot - game.tvd, 2) + Math.pow(oh - game.hd, 2));
            if (dist < min_dist) {
                min_dist = dist;
            }
        }
    }
    return min_dist;
}

// Start Game from Setup Form
setupForm.addEventListener('submit', (e) => {
    e.preventDefault();

    // Parse Inputs
    game.stand_length = parseFloat(document.getElementById('standLength').value);

    game.targets = [
        { tvd: parseFloat(document.getElementById('t1-tvd').value), hd: parseFloat(document.getElementById('t1-hd').value), tol: parseFloat(document.getElementById('t1-tol').value) },
        { tvd: parseFloat(document.getElementById('t2-tvd').value), hd: parseFloat(document.getElementById('t2-hd').value), tol: parseFloat(document.getElementById('t2-tol').value) },
        { tvd: parseFloat(document.getElementById('t3-tvd').value), hd: parseFloat(document.getElementById('t3-hd').value), tol: parseFloat(document.getElementById('t3-tol').value) }
    ];
    game.target_status = ["Pending", "Pending", "Pending"];

    let motorChoice = document.getElementById('motorSelect').value;
    if (motorChoice === '1') { game.motor_yield = 0.75; game.max_consec_slides = Infinity; game.penalty_amount = 0; }
    else if (motorChoice === '2') { game.motor_yield = 1.5; game.max_consec_slides = 6; game.penalty_amount = 50000; }
    else if (motorChoice === '3') { game.motor_yield = 2.0; game.max_consec_slides = 4; game.penalty_amount = 100000; }
    else if (motorChoice === '4') { game.motor_yield = 3.0; game.max_consec_slides = 3; game.penalty_amount = 200000; }

    // Init state
    game.md = 0.0;
    game.tvd = -85.0;
    game.hd = 0.0;
    game.inc = 0.0;
    game.cost = 0.0;
    game.path_tvd = [-85.0];
    game.path_hd = [0.0];
    game.current_consec_slides = 0;
    game.game_over = false;

    let offset = generateOffsetWell();
    game.off_tvd = offset.path_tvd;
    game.off_hd = offset.path_hd;

    // Switch View
    setupPanel.classList.remove('active');
    gameDashboard.classList.add('active');

    initChart();
    updateUI(checkCollision());
    log("Simulation Started.", "success");
    log(`Equipment: Motor ${game.motor_yield}°, Stand ${game.stand_length}ft`, "info");
});

// Stepping Logic
function step(cmd) {
    if (game.game_over) return;

    let is_slide = false;
    let d_inc = 0.0;
    let time_elapsed = 0.0;
    let var_cost = 0;

    if (cmd === 'b') { // Slide Build
        is_slide = true;
        d_inc = game.motor_yield;
        time_elapsed = game.stand_length / ROP_SLIDE;
        var_cost = SLIDE_COST_HR * time_elapsed;
        game.current_consec_slides++;
        log(`Slide Build +${d_inc}°...`, "info");
    } else if (cmd === 'd') { // Slide Drop
        is_slide = true;
        d_inc = -game.motor_yield;
        time_elapsed = game.stand_length / ROP_SLIDE;
        var_cost = SLIDE_COST_HR * time_elapsed;
        game.current_consec_slides++;
        log(`Slide Drop ${d_inc}°...`, "info");
    } else { // Rotate
        is_slide = false;
        d_inc = 0.0;
        time_elapsed = game.stand_length / ROP_ROTATE;
        var_cost = ROTATE_COST_HR * time_elapsed;
        game.current_consec_slides = 0;
        log(`Rotating ahead...`, "info");
    }

    // Penalties
    let penalty_cost = 0.0;
    if (is_slide && game.current_consec_slides > game.max_consec_slides) {
        penalty_cost = game.penalty_amount;
        log(`⚠️ PENALTY: $${penalty_cost.toLocaleString()} (Exceeded Max Slides: ${game.current_consec_slides})`, "error");
    }

    let rig_cost = RIG_RATE_HR * time_elapsed;
    game.cost += (rig_cost + var_cost + penalty_cost);

    // Physics - Min Curvature
    let i1 = game.inc * Math.PI / 180.0;
    game.inc += d_inc;
    if (game.inc < 0) game.inc = 0;
    let i2 = game.inc * Math.PI / 180.0;

    let beta = i2 - i1;
    let rf = 1.0;
    if (Math.abs(beta) >= 0.00001) {
        rf = (2.0 / beta) * Math.tan(beta / 2.0);
    }

    let d_md = game.stand_length;
    let d_tvd = (d_md / 2.0) * (Math.cos(i1) + Math.cos(i2)) * rf;
    let d_hd = (d_md / 2.0) * (Math.sin(i1) + Math.sin(i2)) * rf;

    game.md += d_md;
    game.tvd += d_tvd;
    game.hd += d_hd;

    game.path_tvd.push(game.tvd);
    game.path_hd.push(game.hd);

    checkTargets();

    let end_depth = Math.max(...game.targets.map(t => t.tvd)) + 1000;
    let sep_factor = checkCollision();

    if (sep_factor < 15) {
        log(`💥 CRASH! Intersection with Offset Well. Dist=${sep_factor.toFixed(1)}ft.`, "error");
        endGame();
    } else if (sep_factor < 50) {
        log(`⚠️ ANTI-COLLISION WARNING: ${sep_factor.toFixed(0)} ft`, "warning");
    }

    if (game.tvd >= end_depth && !game.game_over) {
        log(`🏁 Reached Total Depth (TD). Drilling Finished. Final Cost: $${game.cost.toLocaleString()}`, "success");
        endGame();
    }

    updateUI(sep_factor);
    updateChart();
}

// Check Targets
function checkTargets() {
    for (let i = 0; i < game.targets.length; i++) {
        let t = game.targets[i];
        if (game.target_status[i] === "Pending") {
            if (game.tvd >= t.tvd) {
                let prev_tvd = game.path_tvd[game.path_tvd.length - 2];
                let prev_hd = game.path_hd[game.path_hd.length - 2];

                let hd_at_target;
                if (game.tvd !== prev_tvd) {
                    let frac = (t.tvd - prev_tvd) / (game.tvd - prev_tvd);
                    hd_at_target = prev_hd + frac * (game.hd - prev_hd);
                } else {
                    hd_at_target = game.hd;
                }

                let dist = Math.abs(hd_at_target - t.hd);
                if (dist <= t.tol) {
                    game.target_status[i] = `HIT (Off by ${dist.toFixed(1)}ft)`;
                    log(`🎯 Target ${i + 1} HIT! (Missed center by ${dist.toFixed(1)}ft)`, "success");
                } else {
                    game.target_status[i] = `MISS (Off by ${dist.toFixed(1)}ft)`;
                    log(`❌ Target ${i + 1} MISSED! (Off by ${dist.toFixed(1)}ft)`, "error");
                }
            }
        }
    }
}

// UI Updating
function updateUI(sep_factor) {
    document.getElementById('val-md').textContent = `${Math.floor(game.md)} ft`;
    document.getElementById('val-tvd').textContent = `${Math.floor(game.tvd)} ft`;
    document.getElementById('val-hd').textContent = `${Math.floor(game.hd)} ft`;
    document.getElementById('val-inc').textContent = `${game.inc.toFixed(1)}°`;
    document.getElementById('val-slides').textContent = game.current_consec_slides;
    document.getElementById('val-cost').textContent = `$${Math.floor(game.cost).toLocaleString()}`;

    let kopHint = document.getElementById('kop-hint');
    if (game.md < KOP) {
        kopHint.textContent = `To KOP: ${Math.floor(KOP - game.md)}ft`;
        kopHint.style.display = 'block';
    } else {
        kopHint.style.display = 'none';
    }

    let acBox = document.getElementById('ac-box');
    let valAc = document.getElementById('val-ac');
    if (sep_factor > 1000) {
        valAc.textContent = ">1000 ft";
        acBox.classList.remove('danger');
    } else {
        valAc.textContent = `${Math.floor(sep_factor)} ft`;
        if (sep_factor < 50) {
            acBox.classList.add('danger');
            valAc.className = "stat-value text-red";
        } else {
            acBox.classList.remove('danger');
            valAc.className = "stat-value text-amber";
        }
    }

    // Target List
    let tl = document.getElementById('target-list');
    tl.innerHTML = '';
    game.target_status.forEach((status, i) => {
        let li = document.createElement('li');
        let cls = "ts-pending";
        if (status.includes("HIT")) cls = "ts-hit";
        if (status.includes("MISS")) cls = "ts-miss";

        li.className = cls;
        li.innerHTML = `<span>Target ${i + 1}</span> <span>${status}</span>`;
        tl.appendChild(li);
    });
}

function log(msg, type = "info") {
    let logBox = document.getElementById('log-box');
    let entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = msg;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
}

function endGame() {
    game.game_over = true;
    document.getElementById('btn-rotate').disabled = true;
    document.getElementById('btn-slide-build').disabled = true;
    document.getElementById('btn-slide-drop').disabled = true;
    document.getElementById('btn-restart').classList.remove('hidden');
}

// Restart
document.getElementById('btn-restart').addEventListener('click', () => {
    gameDashboard.classList.remove('active');
    setupPanel.classList.add('active');

    document.getElementById('btn-rotate').disabled = false;
    document.getElementById('btn-slide-build').disabled = false;
    document.getElementById('btn-slide-drop').disabled = false;
    document.getElementById('btn-restart').classList.add('hidden');
    document.getElementById('log-box').innerHTML = '<div class="log-entry system">System Initialized. Engine ready.</div>';

    if (chartInstance) {
        chartInstance.destroy();
    }
});

// Button Bindings
document.getElementById('btn-rotate').addEventListener('click', () => step('r'));
document.getElementById('btn-slide-build').addEventListener('click', () => step('b'));
document.getElementById('btn-slide-drop').addEventListener('click', () => step('d'));

// ChartJS Implementation
function initChart() {
    const ctx = document.getElementById('wellChart').getContext('2d');

    // We want Y axis inverted for TVD (Depth goes down).
    // Chart.js requires reversing the axis.

    let targetScatter = game.targets.map(t => ({ x: t.hd, y: t.tvd, tol: t.tol }));
    let offsetData = game.off_tvd.map((tvd, idx) => ({ x: game.off_hd[idx], y: tvd }));

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Active Well',
                    data: [{ x: 0, y: -85 }],
                    borderColor: '#38bdf8', // accent-blue
                    backgroundColor: '#38bdf8',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.1
                },
                {
                    label: 'Current Bit',
                    data: [{ x: 0, y: -85 }],
                    backgroundColor: '#2dd4bf', // teal
                    borderColor: '#2dd4bf',
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    showLine: false
                },
                {
                    label: 'Offset Well',
                    data: offsetData,
                    borderColor: '#94a3b8',
                    borderDash: [5, 5],
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1
                },
                {
                    label: 'Targets',
                    data: targetScatter,
                    backgroundColor: '#f87171',
                    pointRadius: 4, // Make the center dot smaller
                    showLine: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    type: 'linear',
                    title: { display: true, text: 'TVD (ft)', color: '#94a3b8' },
                    reverse: true, // INVERT Y AXIS FOR DEPTH
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    min: -500 // Ensures targets at the bottom don't clip off initially
                },
                x: {
                    type: 'linear',
                    position: 'top',
                    title: { display: true, text: 'Horizontal Departure (ft)', color: '#94a3b8' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    min: -500 // Ensures visibility on edges
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc' } },
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            if (ctx.dataset.label === 'Targets') {
                                return `Target: HD=${ctx.raw.x}, TVD=${ctx.raw.y} (Tol: ±${ctx.raw.tol}ft)`;
                            }
                            return `${ctx.dataset.label}: HD=${Math.floor(ctx.raw.x)}, TVD=${Math.floor(ctx.raw.y)}`;
                        }
                    }
                }
            },
            animation: {
                duration: 0 // Disable animation for instant updates during simulation
            }
        },
        plugins: [{
            id: 'toleranceLines',
            afterDatasetsDraw(chart, args, pluginOptions) {
                const { ctx, data, chartArea: { top, bottom, left, right }, scales: { x, y } } = chart;

                // Find the index of the Targets dataset
                const targetDatasetIndex = data.datasets.findIndex(ds => ds.label === 'Targets');
                if (targetDatasetIndex === -1) return;

                const meta = chart.getDatasetMeta(targetDatasetIndex);
                if (meta.hidden) return;

                ctx.save();
                ctx.beginPath();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#f87171'; // Red color for tolerance

                data.datasets[targetDatasetIndex].data.forEach((datapoint, index) => {
                    // Coordinates of the center
                    const yPos = y.getPixelForValue(datapoint.y);

                    // The tolerance is in feet (HD). We need to calculate the pixel positions
                    // for (HD - tol) and (HD + tol).
                    const xLeft = x.getPixelForValue(datapoint.x - datapoint.tol);
                    const xRight = x.getPixelForValue(datapoint.x + datapoint.tol);

                    // Draw horizontal line for tolerance
                    ctx.moveTo(xLeft, yPos);
                    ctx.lineTo(xRight, yPos);

                    // Add small vertical "caps" at the ends of the tolerance line
                    ctx.moveTo(xLeft, yPos - 5);
                    ctx.lineTo(xLeft, yPos + 5);

                    ctx.moveTo(xRight, yPos - 5);
                    ctx.lineTo(xRight, yPos + 5);
                });

                ctx.stroke();
                ctx.restore();
            }
        }]
    });
}

function updateChart() {
    if (!chartInstance) return;

    // Update path
    let newPath = game.path_tvd.map((tvd, idx) => ({ x: game.path_hd[idx], y: tvd }));
    chartInstance.data.datasets[0].data = newPath;

    // Update bit pointer
    chartInstance.data.datasets[1].data = [{ x: game.hd, y: game.tvd }];

    chartInstance.update();
}
