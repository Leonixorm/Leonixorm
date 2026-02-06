const CONFIG = {
    csvPath: 'https://raw.githubusercontent.com/Leonixorm/Leonixorm/main/Programaci%C3%B3n%20Cosecha.csv',
    apiRoot: 'https://corsproxy.io/?',
    sources: [
        { name: 'Fincas Propias', key: '12345NC5xQdXAxT6jj8WrPH26krbn2y7sf6tt8mf' },
        { name: 'Ullum', key: '123450S8fgNhWDfKUNxnzFr7xb6DK1us2OqJK2' }
    ],
    startDate: '2025-12-10',
    historyPath: 'https://raw.githubusercontent.com/Leonixorm/Leonixorm/main/Cosecha%2013-25.csv'
};

let state = {
    plannedData: [],
    realData: [],
    mergedData: [],
    filters: {
        finca: ['all'],
        variedad: ['all'],
        tipo: ['all'],
        estado: ['all'],
        histCuartel: ['all'],
        histMateria: ['all']
    },
    currentView: 'dashboard',
    historicalData: [],
    charts: {}
};

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Lucide icons
    lucide.createIcons();

    await initDashboard();

    // Event listeners
    document.getElementById('refresh-btn').addEventListener('click', () => initDashboard());
    document.getElementById('finca-filter').addEventListener('change', (e) => handleMultiSelect('finca', e.target));
    document.getElementById('variedad-filter').addEventListener('change', (e) => handleMultiSelect('variedad', e.target));
    document.getElementById('type-filter').addEventListener('change', (e) => handleMultiSelect('tipo', e.target));
    document.getElementById('status-filter').addEventListener('change', (e) => handleMultiSelect('estado', e.target));

    // Nav Listeners
    document.getElementById('nav-dashboard').addEventListener('click', () => switchView('dashboard'));
    document.getElementById('nav-daily').addEventListener('click', () => switchView('daily'));
    document.getElementById('nav-historical').addEventListener('click', () => switchView('historical'));

    // Historico Specific Filters
    document.getElementById('hist-cuartel-filter').addEventListener('change', (e) => handleMultiSelect('histCuartel', e.target));
    document.getElementById('hist-materia-filter').addEventListener('change', (e) => handleMultiSelect('histMateria', e.target));
});

function handleMultiSelect(key, selectEl) {
    const selected = Array.from(selectEl.selectedOptions).map(opt => opt.value);

    // Si se selecciona algo nuevo y estaba 'all', quitar 'all'
    // Si se selecciona 'all', deseleccionar todo lo demás
    const hadAll = state.filters[key].includes('all');
    const hasAll = selected.includes('all');

    if (hasAll && !hadAll) {
        // Se acaba de marcar 'all'
        state.filters[key] = ['all'];
        Array.from(selectEl.options).forEach(opt => {
            if (opt.value !== 'all') opt.selected = false;
        });
    } else if (selected.length > 1 && hasAll) {
        // Tenía 'all' y marcó algo más
        state.filters[key] = selected.filter(v => v !== 'all');
        Array.from(selectEl.options).forEach(opt => {
            if (opt.value === 'all') opt.selected = false;
        });
    } else if (selected.length === 0) {
        state.filters[key] = ['all'];
        selectEl.value = 'all';
    } else {
        state.filters[key] = selected;
    }

    renderDashboard();
}

async function initDashboard() {
    updateBtnState(true);
    showStatus('Iniciando...');

    try {
        if (state.plannedData.length === 0) {
            showStatus('Cargando Programación...');
            await fetchPlannedData();
        }

        if (state.historicalData.length === 0) {
            await fetchHistoricalData();
        }

        showStatus('Consultando APIs (Dec-Hoy)...');
        await fetchRealDataAll();

        mergeAndProcess();
        populateFilters();
        renderDashboard();

        showStatus(`Actualizado: ${new Date().toLocaleTimeString()}`);
    } catch (error) {
        console.error('Error:', error);
        showStatus('Error al cargar datos. Use "Subir CSV" o abra con servidor.', true);
    } finally {
        updateBtnState(false);
    }
}

async function handleManualCSV(e) {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
        header: true,
        delimiter: ";", // Detectado en Programación Cosecha.csv
        skipEmptyLines: true,
        complete: async (results) => {
            state.plannedData = results.data;
            console.log("Manual CSV loaded:", state.plannedData.length, "rows");
            await initDashboard();
        }
    });
}

// 1. Data Fetching
async function fetchPlannedData() {
    return new Promise((resolve, reject) => {
        Papa.parse(CONFIG.csvPath, {
            download: true,
            header: true,
            delimiter: ";", // Forzado por formato detectado
            skipEmptyLines: true,
            complete: (results) => {
                state.plannedData = results.data;
                console.log("Planned data loaded:", state.plannedData.length);
                resolve();
            },
            error: (err) => reject(err)
        });
    });
}

async function fetchHistoricalData() {
    // Si ya hay datos (por carga manual), no reintentar el fetch
    if (state.historicalData.length > 0) return;

    return new Promise((resolve) => {
        Papa.parse(CONFIG.historyPath, {
            download: true,
            header: true,
            delimiter: ";",
            skipEmptyLines: true,
            complete: (results) => {
                state.historicalData = results.data;
                console.log("Historical data loaded automatically");
                resolve();
            },
            error: (err) => {
                console.warn("CORS bloqueó carga automática de Historia. Use el botón 'Cargar Historia'.");
                resolve();
            }
        });
    });
}

function handleManualHistory(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
        header: true,
        delimiter: ";",
        skipEmptyLines: true,
        complete: (results) => {
            state.historicalData = results.data;
            console.log("Manual History loaded:", state.historicalData.length, "rows");
            populateFilters(); // Actualizar el filtro de cuarteles
            if (state.currentView === 'historical') renderHistoricalView();
            showStatus("Historia cargada.");
        }
    });
}

async function fetchRealDataAll() {
    const ranges = getMonthRanges(CONFIG.startDate);
    const apiTasks = [];

    // Priorizamos los últimos meses primero para que el usuario vea datos rápido
    const reversedRanges = [...ranges].reverse();

    for (const source of CONFIG.sources) {
        for (const range of reversedRanges) {
            apiTasks.push(fetchMonthData(source, range.start, range.end));
        }
    }

    const results = await Promise.all(apiTasks);
    state.realData = results.flat();

    const totalRecords = state.realData.length;
    const totalKg = state.realData.reduce((s, r) => s + (parseFloat(r.rendimiento) || 0), 0);
    console.log(`📡 Fetch finalizado. Total: ${totalRecords} registros, ${Math.round(totalKg).toLocaleString()} kg.`);

    if (totalRecords > 0) {
        showStatus('Datos de API cargados.');
    } else {
        showStatus('Sin datos de API.', true);
    }
}
async function fetchMonthData(source, start, end) {
    const sofiaUrl = `http://apisofia.sofiagestionagricola.cl/trabajvsfaenas?nombre_usuario=NATURALFOOD&key_usuario=${source.key}&fecha_inicial=${start}&fecha_final=${end}`;

    // Añadimos un cache-buster (timestamp) para evitar que el proxy nos devuelva datos viejos
    const cacheBuster = `&_cb=${new Date().getTime()}`;
    const proxiedUrl = `https://corsproxy.io/?${encodeURIComponent(sofiaUrl + cacheBuster)}`;

    try {
        const response = await fetch(proxiedUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        let data;
        try {
            data = await response.json();
        } catch (jsonErr) {
            console.warn(`[API ${source.name}] Error en JSON (${start} a ${end}): Datos truncados.`);
            return [];
        }
        const filtered = data.filter(r => {
            const f = String(r.faena || '').toUpperCase();
            const l = String(r.labor || '').toUpperCase();
            const yieldVal = parseFloat(r.rendimiento) || 0;

            // Filtro estricto solicitado: Faena Cosecha + Labor que contenga "COSECHA KG"
            const isHarvestFaena = f === 'COSECHA';
            const isCosechaKg = l.includes('COSECHA KG');

            return isHarvestFaena && isCosechaKg && yieldVal > 0;
        }).map(r => ({ ...r, sourceName: source.name }));

        if (filtered.length > 0) {
            const totalKg = filtered.reduce((s, r) => s + (parseFloat(r.rendimiento) || 0), 0);
            console.log(`[API ${source.name}] ${start}: ${filtered.length} registros, ${Math.round(totalKg).toLocaleString()} kg.`);
        }
        return filtered;
    } catch (e) {
        console.error(`[API ${source.name}] Error en ${start} a ${end}:`, e.message);
        return [];
    }
}

// 2. Data Processing
function mergeAndProcess() {
    // Helper para buscar columnas sin importar mayúsculas/espacios
    // Helper para buscar columnas con sinónimos (Finca, Productor, etc)
    const getVal = (obj, targets) => {
        if (!Array.isArray(targets)) targets = [targets];
        const key = Object.keys(obj).find(k =>
            targets.some(t => k.trim().toLowerCase() === t.toLowerCase())
        );
        return key ? String(obj[key]).trim() : '';
    };

    if (state.plannedData.length > 0) {
        console.log("📌 Columnas en CSV:", Object.keys(state.plannedData[0]));
    }

    const fincaMap = {
        'EEI': 'El Espejo I',
        'EEII': 'El Espejo II',
        'EEIII': 'El Espejo III'
    };

    const realSummary = {};

    const normalize = (str) => String(str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ' ').trim();

    state.realData.forEach(r => {
        const cuartelMatch = String(r.cuartel || '').match(/^(\d+)/);
        const cuartelId = cuartelMatch ? parseInt(cuartelMatch[1], 10) : parseInt(r.id_cuartel, 10);
        let variety = normalize(r.variedad || '');
        let finca = normalize(r.clasificacion || 'Desconocida');

        if (finca === 'eei') finca = normalize('El Espejo I');
        if (finca === 'eeii') finca = normalize('El Espejo II');
        if (finca === 'eeiii') finca = normalize('El Espejo III');

        // INTELIGENCIA ADICIONAL: Si el nombre de la variedad viene vacío de Sofia, 
        // buscamos en la programación qué variedad corresponde a ese productor/cuartel.
        if (!variety || variety === 'desconocida') {
            const programMatch = state.plannedData.find(p =>
                normalize(getVal(p, ['Finca', 'Productor'])) === finca &&
                parseInt(getVal(p, 'Cuartel'), 10) === cuartelId
            );
            if (programMatch) {
                variety = normalize(getVal(programMatch, 'Variedad'));
                console.log(`ℹ️ Variedad inferida para ${finca} C${cuartelId}: ${variety}`);
            }
        }

        const key = `${finca}_${cuartelId}_${variety}`;
        const kg = parseFloat(r.rendimiento) || 0;

        if (!realSummary[key]) realSummary[key] = { kg: 0, source: r.sourceName };
        realSummary[key].kg += kg;
    });

    let matchedCount = 0;
    let totalKgFound = 0;

    state.mergedData = state.plannedData.map(p => {
        const rawFinca = getVal(p, ['Finca', 'Productor', 'Nombre', 'Propietario']);
        const rawVariety = getVal(p, 'Variedad');
        const fincaNorm = normalize(rawFinca);
        const varietyNorm = normalize(rawVariety);

        const cuartelStr = getVal(p, 'Cuartel');
        const cuartel = parseInt(cuartelStr, 10);

        const key = `${fincaNorm}_${cuartel}_${varietyNorm}`;

        const info = realSummary[key] || { kg: 0, source: 'Desconocido' };
        const kgReal = info.kg;
        const isPropia = info.source === 'Fincas Propias';

        if (kgReal > 0) {
            matchedCount++;
            totalKgFound += kgReal;
        }

        let rawPlanned = getVal(p, ['Kg Uva', 'Kg', 'Kilos']);
        let kgPlanned = 0;
        if (rawPlanned) {
            const cleanVal = rawPlanned.replace(/\./g, '').replace(',', '.').trim();
            kgPlanned = parseFloat(cleanVal);
        }

        return {
            finca: rawFinca,
            cuartel: cuartelStr,
            variety: rawVariety,
            planned: isNaN(kgPlanned) ? 0 : kgPlanned,
            real: kgReal,
            status: getVal(p, 'Estado') || 'En proceso',
            tipo: getVal(p, ['Sep.', 'Tipo']) || 'Otros',
            has: parseFloat(getVal(p, 'Has').replace(',', '.')) || 0,
            source: info.source,
            isPropia: isPropia
        };
    }).filter(row => row.finca !== '' && row.finca.toLowerCase() !== 'finca' && row.finca.toLowerCase() !== 'productor');

    console.log(`📊 Mezcla finalizada: ${totalKgFound.toLocaleString()} kg reales asociados a ${matchedCount} filas del CSV.`);

    // AUDITORIA DE DISCREPANCIAS
    const totalRawApi = state.realData.reduce((s, r) => s + (parseFloat(r.rendimiento) || 0), 0);
    if (Math.abs(totalRawApi - totalKgFound) > 1) {
        console.warn(`⚠️ Discrepancia: API tiene ${Math.round(totalRawApi).toLocaleString()} kg pero solo se asociaron ${Math.round(totalKgFound).toLocaleString()} kg al Excel.`);
        console.log("Tip: Verifique que los nombres de Variedades y Cuarteles coincidan exactamente entre Sofia y el Excel.");
    }
}

// 3. Rendering
function renderDashboard() {
    const filtered = applyFiltersToData(state.mergedData);

    if (state.currentView === 'dashboard') {
        renderKPIs(filtered);
        renderFincasGrid(filtered);
        renderTable(filtered);
    } else if (state.currentView === 'daily') {
        renderDailyView();
    } else if (state.currentView === 'historical') {
        renderHistoricalView();
    }
}

function switchView(view) {
    state.currentView = view;
    // UI Update
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.getElementById(`${view}-view`).style.display = 'block';

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`nav-${view}`).classList.add('active');

    renderDashboard();
}

function renderDailyView() {
    const fincaMap = { 'EEI': 'El Espejo I', 'EEII': 'El Espejo II', 'EEIII': 'El Espejo III' };
    const dailyDataPropios = {};
    const dailyDataTerceros = {};

    state.realData.forEach(r => {
        let finca = (r.clasificacion || '').trim();
        if (fincaMap[finca]) finca = fincaMap[finca];
        const variety = (r.variedad || '').trim();
        const date = r.fecha ? r.fecha.split(' ')[0] : (r.fecha_movimiento ? r.fecha_movimiento.split(' ')[0] : 'Sin Fecha');
        const kg = parseFloat(r.rendimiento) || 0;
        const isPropia = r.sourceName === 'Fincas Propias';

        const normalize = (str) => String(str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ' ').trim();
        const fincaMatch = state.filters.finca.includes('all') || state.filters.finca.some(f => normalize(f) === normalize(finca));
        const varietyMatch = state.filters.variedad.includes('all') || state.filters.variedad.some(v => normalize(v) === normalize(variety));

        if (fincaMatch && varietyMatch) {
            if (isPropia) {
                dailyDataPropios[date] = (dailyDataPropios[date] || 0) + kg;
            } else {
                dailyDataTerceros[date] = (dailyDataTerceros[date] || 0) + kg;
            }
        }
    });

    const allDates = [...new Set([...Object.keys(dailyDataPropios), ...Object.keys(dailyDataTerceros)])].sort((a, b) => new Date(a) - new Date(b));

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    const chartLabels = allDates.map(d => {
        const dateObj = new Date(d + 'T12:00:00');
        const dayName = dayNames[dateObj.getDay()];
        const [y, m, day] = d.split('-');
        return `${dayName} ${day}/${m}`;
    });

    const ctx = document.getElementById('daily-chart').getContext('2d');
    if (state.charts.daily) state.charts.daily.destroy();

    state.charts.daily = new Chart(ctx, {
        plugins: [ChartDataLabels],
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: 'Propios',
                    data: allDates.map(d => dailyDataPropios[d] || 0),
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: '#10b981',
                    borderWidth: 1,
                    stack: 'Stack 0'
                },
                {
                    label: 'Terceros',
                    data: allDates.map(d => dailyDataTerceros[d] || 0),
                    backgroundColor: 'rgba(59, 130, 246, 0.7)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    stack: 'Stack 0'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { family: 'Outfit', size: 12 } } },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    offset: 4,
                    color: '#f8fafc',
                    font: { weight: 'bold', size: 10 },
                    formatter: (value, context) => {
                        const date = allDates[context.dataIndex];
                        const total = (dailyDataPropios[date] || 0) + (dailyDataTerceros[date] || 0);
                        // Solo mostrar el total en el dataset de arriba (Terceros es el segundo)
                        if (context.datasetIndex === 1) {
                            return total > 0 ? new Intl.NumberFormat('es-AR').format(Math.round(total)) : '';
                        }
                        return '';
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${new Intl.NumberFormat('es-AR').format(Math.round(ctx.raw))} kg`
                    }
                }
            },
            scales: {
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', callback: (v) => formatKgSimple(v) }
                },
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: {
                        color: (context) => {
                            const label = chartLabels[context.index];
                            if (label.includes('Sab')) return '#fbbf24'; // Amarillo para Sabado
                            if (label.includes('Dom')) return '#f87171'; // Rojo para Domingo
                            return '#94a3b8';
                        },
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            }
        }
    });

    const totalDay = allDates.reduce((sum, d) => sum + (dailyDataPropios[d] || 0) + (dailyDataTerceros[d] || 0), 0);
    document.getElementById('daily-summary').innerHTML = `
        <div class="premium-card">
            <span class="card-label">Total Propios</span>
            <div class="card-value" style="color: var(--accent-emerald)">${new Intl.NumberFormat('es-AR').format(Math.round(allDates.reduce((s, d) => s + (dailyDataPropios[d] || 0), 0)))} kg</div>
        </div>
        <div class="premium-card">
            <span class="card-label">Total Terceros</span>
            <div class="card-value" style="color: #3b82f6">${new Intl.NumberFormat('es-AR').format(Math.round(allDates.reduce((s, d) => s + (dailyDataTerceros[d] || 0), 0)))} kg</div>
        </div>
        <div class="premium-card">
            <span class="card-label">Total Periodo</span>
            <div class="card-value">${new Intl.NumberFormat('es-AR').format(Math.round(totalDay))} kg</div>
        </div>
    `;
}

function formatKgSimple(val) {
    if (val >= 1000) return (val / 1000).toFixed(0) + 'k';
    return val;
}

function renderFincasGrid(data) {
    const grid = document.getElementById('fincas-grid');
    const fincas = [...new Set(data.map(d => d.finca))].sort();

    grid.innerHTML = fincas.map(fincaName => {
        const fincaData = data.filter(d => d.finca === fincaName);
        const isPropia = fincaData.some(d => d.isPropia);
        const totalReal = fincaData.reduce((s, r) => s + r.real, 0);
        const totalPlanned = fincaData.reduce((s, r) => s + r.planned, 0);
        const totalHas = fincaData.reduce((s, r) => s + r.has, 0);
        const progress = totalPlanned > 0 ? (totalReal / totalPlanned) * 100 : 0;

        const realKgHa = totalHas > 0 ? Math.round(totalReal / totalHas) : 0;
        const plannedKgHa = totalHas > 0 ? Math.round(totalPlanned / totalHas) : 0;

        // Desglose por variedad para esta finca
        const varieties = [...new Set(fincaData.map(d => d.variety))];
        const varietyRows = varieties.map(v => {
            const vData = fincaData.filter(d => d.variety === v);
            const vReal = vData.reduce((s, r) => s + r.real, 0);
            const vHas = vData.reduce((s, r) => s + r.has, 0);
            const vKgHa = vHas > 0 ? Math.round(vReal / vHas) : 0;

            return `
                <div class="variety-item">
                    <span>${v} <small style="opacity: 0.6; font-size: 0.7rem;">(${vHas.toFixed(2)} ha)</small></span>
                    <div style="text-align: right;">
                        <span class="variety-val">${formatKg(vReal)}</span>
                        ${isPropia ? `<div style="font-size: 0.7rem; color: var(--accent-emerald)">${vKgHa.toLocaleString()} kg/ha</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="finca-card">
                <div class="finca-header">
                    <div>
                        <div class="finca-name">${fincaName}</div>
                        <div style="color: var(--text-secondary); font-size: 0.8rem; margin-top: 0.25rem;">
                             Est: ${formatKg(totalPlanned)} ${isPropia ? `<span style="opacity: 0.5">| ${plannedKgHa} kg/ha</span>` : ''}
                        </div>
                    </div>
                    <div class="percentage-badge">${Math.round(progress)}%</div>
                </div>
                
                <div class="progress-container">
                    <div class="progress-fill" style="width: ${Math.min(progress, 100)}%"></div>
                </div>

                <div class="variety-list">
                    <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 0.5rem; letter-spacing: 1px;">Rendimiento Real:</div>
                    ${varietyRows}
                </div>
                
                <div style="margin-top: auto; padding-top: 1rem; border-top: 1px solid var(--glass-border); display: flex; justify-content: space-between; align-items: flex-end;">
                    <div>
                        <span style="color: var(--text-secondary); font-size: 0.85rem;">Total Finca:</span>
                        <div style="font-weight: 800; color: var(--accent-emerald); font-size: 1.1rem;">${formatKg(totalReal)}</div>
                    </div>
                    <div style="text-align: right;">
                        <span style="color: var(--text-secondary); font-size: 0.75rem;">Global Finca:</span>
                        <div style="font-weight: 700; color: var(--accent-emerald)">${realKgHa.toLocaleString()} kg/ha</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function applyFiltersToData(data) {
    return data.filter(d => {
        const fincaMatch = state.filters.finca.includes('all') || state.filters.finca.includes(d.finca);
        const varietyMatch = state.filters.variedad.includes('all') || state.filters.variedad.includes(d.variety);
        const typeMatch = state.filters.tipo.includes('all') || state.filters.tipo.includes(d.tipo);
        const statusMatch = state.filters.estado.includes('all') || state.filters.estado.includes(d.status);

        return fincaMatch && varietyMatch && typeMatch && statusMatch;
    });
}

function renderKPIs(data) {
    const normalize = (str) => String(str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ' ').trim();
    const fincaMap = { 'EEI': 'El Espejo I', 'EEII': 'El Espejo II', 'EEIII': 'El Espejo III' };

    const totalRealGlobal = state.realData.reduce((sum, r) => {
        let finca = (r.clasificacion || '').trim();
        if (fincaMap[finca]) finca = fincaMap[finca];
        const variety = (r.variedad || '').trim();

        const fincaMatch = state.filters.finca.includes('all') ||
            state.filters.finca.some(f => normalize(f) === normalize(finca));
        const varietyMatch = state.filters.variedad.includes('all') ||
            state.filters.variedad.some(v => normalize(v) === normalize(variety));

        return (fincaMatch && varietyMatch) ? sum + (parseFloat(r.rendimiento) || 0) : sum;
    }, 0);

    const totalPlanned = data.reduce((s, row) => s + row.planned, 0);
    const progress = totalPlanned > 0 ? (totalRealGlobal / totalPlanned) * 100 : 0;

    const finishedCount = data.filter(d => String(d.status).toLowerCase().includes('terminado')).length;
    const totalCount = data.length;

    document.getElementById('kpi-real').textContent = formatKg(totalRealGlobal);
    document.getElementById('kpi-planned').textContent = formatKg(totalPlanned);
    document.getElementById('kpi-finished').textContent = `${finishedCount}/${totalCount}`;
    document.getElementById('kpi-progress').textContent = `${progress.toFixed(1)}%`;
}


function renderTable(data) {
    const tbody = document.querySelector('#details-table tbody');
    tbody.innerHTML = data.map(d => {
        const delta = d.real - d.planned;
        // Lógica de badge basada en la columna Estado real
        const isTerminado = String(d.status).toLowerCase().includes('terminado');
        const statusClass = isTerminado ? 'status-completed' : (d.real > 0 ? 'status-active' : 'status-pending');
        const statusLabel = d.status || (d.real > 0 ? 'Cosechando' : 'Pendiente');

        return `
            <tr>
                <td>${d.finca}</td>
                <td>${d.cuartel} <small style="opacity: 0.5">(${d.has.toFixed(2)} ha)</small></td>
                <td>${d.variety}</td>
                <td>${formatKg(d.planned)} ${d.isPropia ? `<br><small style="opacity: 0.5">${Math.round(d.planned / d.has || 0).toLocaleString()} kg/ha</small>` : ''}</td>
                <td>${formatKg(d.real)} ${d.isPropia ? `<br><small style="color: var(--accent-emerald)">${Math.round(d.real / d.has || 0).toLocaleString()} kg/ha</small>` : ''}</td>
                <td style="color: ${delta >= 0 ? '#10b981' : '#ef4444'}">${formatKg(delta)}</td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            </tr>
        `;
    }).join('');
}

// Helpers
function getMonthRanges(startDate) {
    const ranges = [];
    // Usamos el mediodía local para evitar que el ajuste de zona horaria nos mueva de día al parsear
    let current = new Date(startDate + 'T12:00:00');
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    while (current <= today) {
        const d = current.toISOString().split('T')[0];
        // IMPORTANTE: Usamos rangos de 1 día (start=end) para evitar errores 413 (Payload Too Large)
        // y truncamiento de JSON por parte de proxies en periodos de alta carga como febrero.
        ranges.push({ start: d, end: d });
        current.setDate(current.getDate() + 1);
    }
    return ranges;
}


function formatKg(val) {
    return new Intl.NumberFormat('es-AR').format(Math.round(val)) + ' kg';
}

function populateFilters() {
    const fincas = [...new Set(state.mergedData.map(d => d.finca))].sort();
    const varieties = [...new Set(state.mergedData.map(d => d.variety))].sort();

    const fincaSelect = document.getElementById('finca-filter');
    const varietySelect = document.getElementById('variedad-filter');

    const curFinca = state.filters.finca;
    fincaSelect.innerHTML = `<option value="all" ${curFinca.includes('all') ? 'selected' : ''}>Fincas: Todas</option>` +
        fincas.map(f => `<option value="${f}" ${curFinca.includes(f) ? 'selected' : ''}>${f}</option>`).join('');

    const curVar = state.filters.variedad;
    varietySelect.innerHTML = `<option value="all" ${curVar.includes('all') ? 'selected' : ''}>Variedades: Todas</option>` +
        varieties.map(v => `<option value="${v}" ${curVar.includes(v) ? 'selected' : ''}>${v}</option>`).join('');

    // Materia Prima (Estado en Cosecha 13-25)
    const histMateriaSelect = document.getElementById('hist-materia-filter');
    if (histMateriaSelect) {
        const curMat = state.filters.histMateria;
        histMateriaSelect.innerHTML = `
            <option value="all" ${curMat.includes('all') ? 'selected' : ''}>Materia: Todas</option>
            <option value="Uva" ${curMat.includes('Uva') ? 'selected' : ''}>Uva</option>
            <option value="Pasa" ${curMat.includes('Pasa') ? 'selected' : ''}>Pasa</option>
        `;
    }

    // Populate Historical Cuartel Filter
    populateHistoricalCuartels();
}

function populateHistoricalCuartels() {
    const histCuartelSelect = document.getElementById('hist-cuartel-filter');
    if (!histCuartelSelect || state.historicalData.length === 0) return;

    // Detectar llaves
    const sample = state.historicalData[0];
    const kFinca = Object.keys(sample).find(k => k.toLowerCase() === 'finca') || 'Finca';
    const kVariedad = Object.keys(sample).find(k => k.toLowerCase() === 'variedad') || 'Variedad';
    const kCuartel = Object.keys(sample).find(k => k.toLowerCase() === 'cuartel') || 'Cuartel';

    // Filtrar data por finca y variedad actuales del dashboard para ver qué cuarteles hay
    const available = state.historicalData.filter(d => {
        const fincaMatch = state.filters.finca.includes('all') || state.filters.finca.includes(d[kFinca]);
        const varietyMatch = state.filters.variedad.includes('all') || state.filters.variedad.includes(d[kVariedad]);
        return fincaMatch && varietyMatch;
    });

    const cuarteles = [...new Set(available.map(d => d[kCuartel]))].filter(Boolean).sort((a, b) => a - b);

    // Guardar selección actual
    const curCuartel = state.filters.histCuartel;

    histCuartelSelect.innerHTML = `<option value="all" ${curCuartel.includes('all') ? 'selected' : ''}>Cuarteles: Todos</option>` +
        cuarteles.map(c => `<option value="${c}" ${curCuartel.includes(String(c)) ? 'selected' : ''}>${c}</option>`).join('');
}

function applyFilter(key, value) {
    state.filters[key] = value;
    renderDashboard();
}

function showStatus(msg, isError = false) {
    const el = document.getElementById('last-update');
    el.textContent = msg;
    el.style.borderColor = isError ? 'var(--accent-danger)' : 'var(--accent-emerald)';
    el.style.color = isError ? 'var(--accent-danger)' : 'var(--accent-emerald)';
}

function updateBtnState(isLoading) {
    const btn = document.getElementById('refresh-btn');
    btn.disabled = isLoading;
    btn.innerHTML = isLoading ? '<i class="loader"></i> Cargando...' : '<i data-lucide="refresh-cw"></i> Actualizar';
    if (!isLoading) lucide.createIcons();
}

function renderHistoricalView() {
    if (state.historicalData.length === 0) return;

    // 0. Actualizar los cuarteles disponibles según Finca/Variedad antes de filtrar
    populateHistoricalCuartels();

    // Detectar llaves reales una sola vez para eficiencia
    const sample = state.historicalData[0];
    const kCuartel = Object.keys(sample).find(k => k.toLowerCase() === 'cuartel') || 'Cuartel';
    const kFinca = Object.keys(sample).find(k => k.toLowerCase() === 'finca') || 'Finca';
    const kVariedad = Object.keys(sample).find(k => k.toLowerCase() === 'variedad') || 'Variedad';
    const kEstado = Object.keys(sample).find(k => k.toLowerCase() === 'estado') || 'Estado';

    // 1. Filtrar histórico
    const historyFiltered = state.historicalData.filter(d => {
        const fincaMatch = state.filters.finca.includes('all') || state.filters.finca.includes(d[kFinca]);
        const varietyMatch = state.filters.variedad.includes('all') || state.filters.variedad.includes(d[kVariedad]);
        const cuartelMatch = state.filters.histCuartel.includes('all') || state.filters.histCuartel.includes(String(d[kCuartel]));
        const materiaMatch = state.filters.histMateria.includes('all') || state.filters.histMateria.some(m => String(d[kEstado]).toLowerCase() === m.toLowerCase());
        return fincaMatch && varietyMatch && cuartelMatch && materiaMatch;
    });

    const kKg = Object.keys(sample).find(k => k.toLowerCase() === 'kg') || 'Kg';
    const kHas = Object.keys(sample).find(k => k.toLowerCase() === 'has') || 'Has';

    // 2. Procesar datos históricos por año
    const yearsData = {};
    const yearsHas = {};

    historyFiltered.forEach(d => {
        const yearKey = Object.keys(d).find(k => k.toLowerCase().includes('a') && k.toLowerCase().includes('o')) || 'Año';
        const year = String(d[yearKey] || '').trim();
        if (!year) return;

        if (!yearsData[year]) {
            yearsData[year] = 0;
            yearsHas[year] = 0;
        }

        const cleanKg = parseFloat(String(d[kKg] || 0).replace(/\./g, '').replace(',', '.')) || 0;
        const cleanHas = parseFloat(String(d[kHas] || 0).replace(',', '.')) || 0;

        yearsData[year] += cleanKg;
        yearsHas[year] += cleanHas;
    });

    // 3. Obtener datos REALES de 2026 (mergedData) para comparar
    const real2026Filtered = applyFiltersToData(state.mergedData);
    const sumReal2026 = real2026Filtered.reduce((s, r) => s + r.real, 0);
    const sumHas2026 = real2026Filtered.reduce((s, r) => s + r.has, 0);

    // 4. Preparar labels y datasets
    let sortedYears = Object.keys(yearsData).sort();

    // Asegurarnos que BP 2026 esté al final (si existe) y agregar "Real 2026"
    const labels = sortedYears.map(y => y === 'BP 2026' ? 'Estimado 2026' : y);
    labels.push('Real 2026');

    const kgVolumes = sortedYears.map(y => yearsData[y]);
    kgVolumes.push(sumReal2026);

    const productivityLine = sortedYears.map(y => yearsHas[y] > 0 ? Math.round(yearsData[y] / yearsHas[y]) : 0);
    productivityLine.push(sumHas2026 > 0 ? Math.round(sumReal2026 / sumHas2026) : 0);

    const ctx = document.getElementById('historical-chart').getContext('2d');
    if (state.charts.historical) state.charts.historical.destroy();

    state.charts.historical = new Chart(ctx, {
        plugins: [ChartDataLabels],
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Volumen Cosecha (Kg)',
                    data: kgVolumes,
                    backgroundColor: labels.map(l => l === 'Real 2026' ? 'rgba(129, 140, 248, 0.7)' : 'rgba(16, 185, 129, 0.6)'),
                    borderColor: labels.map(l => l === 'Real 2026' ? '#818cf8' : '#10b981'),
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'y',
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        color: '#f8fafc',
                        font: { weight: 'bold', size: 10 },
                        formatter: (val) => new Intl.NumberFormat('es-AR').format(Math.round(val))
                    }
                },
                {
                    type: 'line',
                    label: 'Productividad (Kg/Ha)',
                    data: productivityLine,
                    borderColor: '#fbbf24',
                    backgroundColor: '#fbbf24',
                    borderWidth: 3,
                    pointRadius: 4,
                    tension: 0.3,
                    yAxisID: 'y1',
                    datalabels: {
                        anchor: 'start',
                        align: 'top',
                        color: '#fbbf24',
                        offset: 10,
                        font: { weight: 'bold', size: 10 },
                        formatter: (val) => val > 0 ? val.toLocaleString() + ' kg/ha' : ''
                    }
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 30 } },
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { family: 'Outfit' } } },
                datalabels: {
                    display: (ctx) => ctx.datasetIndex === 0 || (ctx.datasetIndex === 1 && ctx.active)
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const val = new Intl.NumberFormat('es-AR').format(ctx.raw);
                            return ctx.datasetIndex === 0 ? `Total: ${val} kg` : `Rend: ${val} kg/ha`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', callback: (v) => formatKgSimple(v) },
                    title: { display: true, text: 'Kilos Totales', color: '#94a3b8' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { display: false },
                    ticks: { color: '#fbbf24', callback: (v) => formatKgSimple(v) },
                    title: { display: true, text: 'Rendimiento (Kg/Ha)', color: '#fbbf24' }
                },
                x: { ticks: { color: '#94a3b8' } }
            }
        }
    });

    // Calcular KPIs históricos rápidos
    const totalDay = kgVolumes.reduce((a, b) => a + b, 0);
    const avgYield = productivityLine.filter(v => v > 0).reduce((a, b, i, arr) => a + b / arr.length, 0);

    document.getElementById('historical-summary').innerHTML = `
        <div class="premium-card">
            <span class="card-label">Media Productividad</span>
            <div class="card-value" style="color: #fbbf24">${Math.round(avgYield).toLocaleString()} kg/ha</div>
        </div>
        <div class="premium-card">
            <span class="card-label">Kilos Totales (Selec.)</span>
            <div class="card-value">${formatKg(totalDay)}</div>
        </div>
        <div class="premium-card">
            <span class="card-label">Eficiencia 2026 vs BP</span>
            <div class="card-value">${sumHas2026 > 0 ? Math.round(sumReal2026 / sumHas2026).toLocaleString() : 0} kg/ha</div>
        </div>
    `;
}
