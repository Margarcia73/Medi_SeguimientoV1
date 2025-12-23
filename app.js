// CONFIGURACIÓN
const API_URL = "https://script.google.com/macros/s/AKfycbxuw4fGqJFUT0QbG5i6c-l0NaPlfTF06wigvn5A66TnCnMk4p5ef8QxKsG9lPa2lFtX/exec";

let appState = {
    user: null,
    puesto: null,
    patientsList: [],
    filteredPatients: [],
    filteredPatients: [],
    fullDataCache: null // Guardaremos aquí los detalles para no pedirlos 2 veces
};

let charts = { cond: null, seg: null };

// DOM Globals
const loginScreen = document.getElementById('login-screen');
const registerScreen = document.getElementById('register-screen');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loadingOverlay = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

// Admin Elements
const adminFilterContainer = document.getElementById('admin-filter-container-moved');
const adminPuestoFilter = document.getElementById('admin-puesto-filter');
const adminDashboardPanel = document.getElementById('admin-dashboard-panel');
const mainNav = document.getElementById('main-nav');
const statTotal = document.getElementById('stat-total-pacientes');
const statTop = document.getElementById('stat-top-condicion');

// INIT
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    const today = new Date().toISOString().split('T')[0];
    const fechaInput = document.getElementById('fecha-visita');
    if (fechaInput) fechaInput.value = today;
});

// SESIÓN
function checkSession() {
    const sesion = localStorage.getItem('med_user');
    if (sesion) iniciarApp(JSON.parse(sesion));
}

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    showLoading('Entrando...');
    postData({ action: 'login', usuario: u, password: p }).then(resp => {
        hideLoading();
        if (resp.success) {
            const data = { usuario: u, nombre: resp.nombre, puesto: resp.puesto };
            localStorage.setItem('med_user', JSON.stringify(data));
            iniciarApp(data);
        } else {
            alert(resp.message);
        }
    });
});

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('med_user');
    location.reload();
});

// INICIAR APP
function iniciarApp(userData) {
    appState.user = userData.usuario;
    appState.puesto = userData.puesto;

    // Elementos removidos del HTML por diseño, evitamos error JS
    const uName = document.getElementById('user-display-name');
    const uPuesto = document.getElementById('user-puesto-name');
    if (uName) uName.innerText = userData.nombre;
    if (uPuesto) uPuesto.innerText = userData.puesto;

    loginScreen.classList.remove('active');
    registerScreen.classList.remove('active');
    appContainer.classList.add('active');

    if (appState.puesto === "Coordinador PMC") {
        // ADMIN MODO
        // ADMIN MODO
        // document.getElementById('user-puesto-name').innerText = "Administrador"; // Elemento removido
        if (uPuesto) uPuesto.innerText = "Administrador";  // Usar referencia segura si existe
        adminFilterContainer.classList.remove('hidden');
        adminDashboardPanel.classList.remove('hidden');

        // CORRECCION FINAL: Admin NO ve la barra de navegación ni el registro
        mainNav.classList.add('hidden');
        document.getElementById('registro-view').classList.remove('active-view');
        document.getElementById('registro-view').classList.add('hidden');

        // Ocultar la parte de registro extra que habíamos activado
        document.getElementById('register-visit-puesto-container').classList.add('hidden');

        // CORRECCIÓN: Ocultar la vista antigua de reportes (abajo) porque ya está en el lateral
        document.getElementById('reportes-view').classList.add('hidden');
        document.getElementById('reportes-view').style.display = 'none'; // Forzar ocultado

        // No mostramos ninguna 'view' estándar de inicio, nos quedamos con el dashboard panel
        // Pero si queremos navegar a registro, eso funciona con los botones de abajo.
        // Simulamos estar en una vista "neutra" o registro si se pide.
        // Para que no se vea el bloque blanco de abajo duplicado:

        document.getElementById('report-title').innerText = "Gestión de Pacientes";

        // Asegurar que el filtro empiece en TODOS
        adminPuestoFilter.value = "TODOS";
    } else {
        // ESTUDIANTE MODO
        adminFilterContainer.classList.add('hidden');
        adminDashboardPanel.classList.add('hidden');
        mainNav.classList.remove('hidden');
        showView('registro-view');
    }

    // Cargar lista inicial
    loadPatientsList("TODOS");
}

// LOGICA DE CARGA Y FILTROS
adminPuestoFilter.addEventListener('change', () => {
    loadPatientsList(adminPuestoFilter.value);
});

function loadPatientsList(filterVal) {
    // CORRECCIÓN CRÍTICA:
    // Si el filtro es "TODOS" (o null al inicio), pedimos al backend como "Coordinador PMC" (Admin)
    // para que nos devuelva la lista global completa.
    // Si elegimos un puesto específico, pedimos ese puesto.

    let requestPuesto = filterVal;

    // SEGURIDAD: Si el usuario NO es admin ("Coordinador PMC"), 
    // SIEMPRE debe ver solo su puesto, sin importar qué filtro se solicite.
    if (appState.puesto && appState.puesto !== "Coordinador PMC") {
        requestPuesto = appState.puesto;
    } else {
        // Si ES Admin (o user nulo por error, aunque no debería):
        // Si el filtro es "TODOS" (o null), pedimos con la clave de admin para ver todo.
        if (!requestPuesto || requestPuesto === "TODOS") {
            requestPuesto = "Coordinador PMC";
        }
        // Si seleccionó un puesto específico, requestPuesto ya lo tiene.
    }

    if (appState.puesto === "Coordinador PMC") showLoading("Analizando datos...");

    postData({ action: 'getPatients', puesto: requestPuesto })
        .then(resp => {
            if (resp.success) {
                appState.patientsList = resp.lista;
                appState.filteredPatients = resp.lista;
                updateUIList();

                // Si soy admin y hay pacientes, calculo estadísticas reales
                if (appState.puesto === "Coordinador PMC") {
                    calculateRealStats();
                } else {
                    hideLoading();
                }
            } else {
                hideLoading();
            }
        });
}

// CÁLCULO DE ESTADÍSTICAS REALES (SIN CAMBIAR BACKEND)
function calculateRealStats() {
    statTotal.innerText = appState.filteredPatients.length;

    if (appState.filteredPatients.length === 0) {
        statTop.innerText = "Sin datos";
        document.getElementById('stat-cambios-tx').innerText = "0";
        appState.fullDataCache = {};
        renderCharts({}, 0, 0); // Limpiar gráficos
        hideLoading();
        return;
    }

    // Pedimos el historial de todos para ver sus enfermedades
    // (Esto es rápido para < 100 pacientes, si crece mucho habría que paginar)
    const ids = appState.filteredPatients.map(p => p.id);

    postData({ action: 'getHistoryBatch', ids: ids.join(',') })
        .then(resp => {
            hideLoading();
            if (resp.success) {
                appState.fullDataCache = resp.data; // Guardamos para el Excel

                // Algoritmo para encontrar Top Condición y Datos Gráficos
                const counts = {};
                let cambiosTxCount = 0;

                for (const [id, obj] of Object.entries(resp.data)) {
                    if (obj.visitas && obj.visitas.length > 0) {
                        // Tomamos el diagnóstico de la ÚLTIMA visita
                        const lastVisit = obj.visitas[obj.visitas.length - 1];
                        const diag = lastVisit.diagnostico;
                        counts[diag] = (counts[diag] || 0) + 1;

                        // Contar si hubo cambio de tratamiento en la última visita
                        if (lastVisit.cambios && lastVisit.cambios.toLowerCase() === "si") {
                            cambiosTxCount++;
                        }
                    }
                }

                // Buscar el mayor
                let maxCount = 0;
                let topDiag = "-";
                for (const [diag, count] of Object.entries(counts)) {
                    if (count > maxCount) {
                        maxCount = count;
                        topDiag = diag;
                    }
                }
                // Formato corto para el dashboard
                if (topDiag.length > 15) topDiag = topDiag.substring(0, 12) + "...";
                statTop.innerText = maxCount > 0 ? `${topDiag} (${maxCount})` : "Sin datos";

                // Actualizar Stats Nuevos
                document.getElementById('stat-cambios-tx').innerText = cambiosTxCount;

                // Renderizar Gráficos
                renderCharts(counts, appState.filteredPatients.length, cambiosTxCount);

            }
        });
}

function renderCharts(diagCounts, totalPatients, cambiosTxCount) {
    if (charts.cond) charts.cond.destroy();
    if (charts.seg) charts.seg.destroy();

    if (totalPatients === 0) return; // Si no hay datos, dejamos los canvas limpios

    // 1. Gráfico Pastel: Diagnósticos
    const ctx1 = document.getElementById('chart-condiciones').getContext('2d');
    charts.cond = new Chart(ctx1, {
        type: 'doughnut',
        data: {
            labels: Object.keys(diagCounts),
            datasets: [{
                data: Object.values(diagCounts),
                backgroundColor: ['#4cc9f0', '#4361ee', '#3a0ca3', '#7209b7', '#f72585', '#fb8500'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
            }
        }
    });

    // 2. Gráfico Barras: Seguimiento Cambios Tx
    const ctx2 = document.getElementById('chart-seguimiento').getContext('2d');
    charts.seg = new Chart(ctx2, {
        type: 'bar',
        data: {
            labels: ['Total Pacientes', 'Con Cambios Tx'],
            datasets: [{
                label: 'Pacientes',
                data: [totalPatients, cambiosTxCount],
                backgroundColor: ['#1b263b', '#ef233c'],
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function updateUIList() {
    const select = document.getElementById('select-paciente');
    const container = document.getElementById('patient-checklist');

    // 1. Dropdown
    let html = '<option value="">Seleccione...</option>';
    appState.filteredPatients.forEach(p => { html += `<option value="${p.id}">${p.nombre}</option>`; });
    select.innerHTML = html;

    // 2. Checklist (Actualizar AMBOS contenedores si existen)
    const containers = [
        document.getElementById('patient-checklist'),
        document.getElementById('patient-checklist-admin')
    ];

    containers.forEach(container => {
        if (!container) return;
        container.innerHTML = '';
        if (appState.filteredPatients.length === 0) {
            container.innerHTML = '<div class="empty-msg">No se encontraron pacientes.</div>';
        } else {
            appState.filteredPatients.forEach(p => {
                const item = document.createElement('div');
                item.className = 'checklist-item';
                item.innerHTML = `
                <input type="checkbox" class="pat-check" value="${p.id}" id="chk-${p.id}-${Math.random()}"> <!-- Random ID para evitar conflictos de labels -->
                <label class="checklist-label" for="chk-${p.id}">${p.nombre}</label>
            `;
                // Ajuste para el click en el label funcione con el ID random o genérico
                // Simplificación: al hacer click en el item, togglear el check
                item.addEventListener('click', (e) => {
                    if (e.target.type !== 'checkbox') {
                        const chk = item.querySelector('input');
                        chk.checked = !chk.checked;
                    }
                });
                container.appendChild(item);
            });
        }
    });
}

// EXPORTAR EXCEL
document.getElementById('btn-export-excel').addEventListener('click', () => {
    if (!appState.fullDataCache || Object.keys(appState.fullDataCache).length === 0) {
        return alert("Espere a que carguen los datos o no hay pacientes.");
    }
    // downloadCSV(appState.fullDataCache); // DEPRECATED
    downloadExcel(appState.fullDataCache);
});

// EXPORTAR EXCEL REAL (.XLSX)
function downloadExcel(dataMap) {
    // 1. Aplanar datos
    const rows = [];
    for (const [id, obj] of Object.entries(dataMap)) {
        if (!obj.visitas) continue;
        obj.visitas.forEach(v => {
            rows.push({
                "ID Sistema": id,
                "Nombre Paciente": obj.info.nombre,
                "DPI": obj.info.dpi || "-",
                "Puesto Salud": obj.info.puesto,
                "Fecha Visita": v.fecha,
                "Diagnóstico": v.diagnostico,
                "Presión Arterial": v.pa,
                "Frecuencia Cardíaca": v.fc,
                "Frecuencia Respiratoria": v.fr,
                "SpO2": v.spo2,
                "Temperatura": v.temp,
                "Tratamiento": v.tratamiento,
                "Hubo Cambios?": v.cambios,
                "Comentarios": v.comentarios,
                "Registrado Por": v.usuario_registro || "-"
            });
        });
    }

    // 2. Crear hoja de trabajo
    const worksheet = XLSX.utils.json_to_sheet(rows);

    // 3. Crear libro
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte Detallado");

    // 4. Descargar
    XLSX.writeFile(workbook, "Reporte_Pacientes_Cronicos.xlsx");
}

// NAVEGACIÓN Y VISTAS
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
    document.getElementById(viewId).classList.add('active-view');
}
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const target = item.getAttribute('data-target');

        // Lógica Especial Admin
        if (appState.puesto === "Coordinador PMC" && target === 'reportes-view') {
            // Si es admin y toca Reportes, solo scrolleamos arriba al dashboard
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Ocultar registro, mostrar dashboard
            document.getElementById('registro-view').classList.remove('active-view');
            document.getElementById('admin-dashboard-panel').classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        // Lógica Normal
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        // Si es Admin y va a Registro, ocultar Dashboard
        if (appState.puesto === "Coordinador PMC" && target === 'registro-view') {
            document.getElementById('admin-dashboard-panel').classList.add('hidden');
        }

        showView(target);
    });
});

// LOGICA REGISTRO VISITA (Para Estudiantes y Admins que quieran probar)
window.togglePatientType = function (type) {
    const btnEx = document.getElementById('btn-existente');
    const btnNew = document.getElementById('btn-nuevo');
    const secEx = document.getElementById('section-existente');
    const secNew = document.getElementById('section-nuevo');
    if (type === 'existente') {
        btnEx.classList.add('active'); btnNew.classList.remove('active');
        secEx.classList.remove('hidden'); secNew.classList.add('hidden');
    } else {
        btnNew.classList.add('active'); btnEx.classList.remove('active');
        secNew.classList.remove('hidden'); secEx.classList.add('hidden');
    }
}
document.getElementById('registro-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const isNew = document.getElementById('btn-nuevo').classList.contains('active');
    let idP = "", nom = "", dpi = "";
    if (isNew) {
        nom = document.getElementById('new-nombre').value;
        dpi = document.getElementById('new-dpi').value;
    } else {
        idP = document.getElementById('select-paciente').value;
        const pObj = appState.filteredPatients.find(p => p.id === idP);
        nom = pObj ? pObj.nombre : "";
    }
    let puestoFinal = appState.puesto;
    if (appState.puesto === "Coordinador PMC") {
        puestoFinal = document.getElementById('register-visit-puesto').value;
        if (!puestoFinal) return alert("Por favor seleccione el Puesto para el registro.");
    }
    const data = {
        action: 'saveVisit', puesto: puestoFinal, usuario_registro: appState.user,
        idPaciente: idP, nombre_paciente: nom, dpi: dpi,
        fecha_visita: document.getElementById('fecha-visita').value,
        condicion: document.getElementById('condicion').value,
        fc: document.getElementById('vital-fc').value, pa: document.getElementById('vital-pa').value,
        temp: document.getElementById('vital-temp').value, fr: document.getElementById('vital-fr').value,
        spo2: document.getElementById('vital-spo2').value, tratamiento: document.getElementById('tratamiento').value,
        cambios: document.getElementById('cambios').value, comentarios: document.getElementById('comentarios').value
    };
    showLoading('Guardando...');
    postData(data).then(resp => {
        hideLoading();
        if (resp.success) {
            alert("¡Guardado!"); document.getElementById('registro-form').reset(); loadPatientsList(adminPuestoFilter.value || "TODOS");
        } else alert("Error: " + resp.message);
    });
});

// HISTORIAL MODAL
const historyModal = document.getElementById('history-modal');
const btnViewHistory = document.getElementById('btn-view-history');
const btnCloseHistory = document.getElementById('btn-close-history');

if (btnViewHistory) {
    btnViewHistory.addEventListener('click', () => {
        const patientId = document.getElementById('select-paciente').value;
        if (!patientId) return alert("Por favor seleccione un paciente primero.");

        showLoading("Cargando historial...");
        postData({ action: 'getHistoryBatch', ids: patientId })
            .then(resp => {
                hideLoading();
                if (resp.success && resp.data[patientId]) {
                    renderHistoryModal(resp.data[patientId]);
                } else {
                    alert("No se pudo obtener el historial.");
                }
            });
    });
}

if (btnCloseHistory) {
    btnCloseHistory.addEventListener('click', () => {
        historyModal.classList.add('hidden');
    });
}

function renderHistoryModal(patientData) {
    const container = document.getElementById('history-content');
    const visitas = patientData.visitas || [];
    const pInfo = patientData.info;

    // Título del paciente
    let html = `<div style="margin-bottom:15px; color:#0056b3;">
        <strong>Paciente:</strong> ${pInfo.nombre}<br>
        <small>${pInfo.puesto}</small>
    </div>`;

    if (visitas.length === 0) {
        html += '<p>No hay visitas registradas.</p>';
    } else {
        // Ordenar: más reciente primero
        visitas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        visitas.forEach(v => {
            html += `
            <div class="history-item">
                <div class="history-date">
                    <span>${v.fecha}</span>
                    <span style="font-weight:normal; font-size:0.85rem;">${v.diagnostico}</span>
                </div>
                <div class="history-detail"><strong>Signos:</strong> PA: ${v.pa} | FC: ${v.fc} | SpO2: ${v.spo2}%</div>
                <div class="history-detail"><strong>Tx:</strong> ${v.tratamiento || '-'}</div>
                <div class="history-detail"><strong>Cambios:</strong> ${v.cambios}</div>
                <div class="history-detail"><strong>Obs:</strong> ${v.comentarios || '-'}</div>
            </div>`;
        });
    }

    container.innerHTML = html;
    historyModal.classList.remove('hidden');
}

// PDF
document.getElementById('btn-select-all').addEventListener('click', () => { document.querySelectorAll('.pat-check').forEach(c => c.checked = true); });
document.getElementById('btn-deselect-all').addEventListener('click', () => { document.querySelectorAll('.pat-check').forEach(c => c.checked = false); });
document.getElementById('btn-generate-pdf').addEventListener('click', () => {
    const checked = document.querySelectorAll('.pat-check:checked');
    if (checked.length === 0) return alert("Seleccione pacientes.");
    const ids = Array.from(checked).map(c => c.value);
    // Si ya tenemos fullDataCache, no pedimos de nuevo (optimización)
    if (appState.fullDataCache && Object.keys(appState.fullDataCache).length >= ids.length) {
        // Filtrar solo los seleccionados del cache
        const subset = {};
        ids.forEach(id => { if (appState.fullDataCache[id]) subset[id] = appState.fullDataCache[id]; });
        generatePDF(subset);
    } else {
        showLoading(`Recuperando datos...`);
        postData({ action: 'getHistoryBatch', ids: ids.join(',') }).then(resp => {
            hideLoading(); generatePDF(resp.data);
        });
    }
});

// PDF: FUNCIONALIDAD CONTINUA (Un paciente tras otro)
function generatePDF(dataMap) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'letter'); // Cambiado a Vertical (Portrait) para lista larga, o 'l' si tabla muy ancha. Usaremos 'l' si prefieres landscape. 
    // Usuario no especificó orientación, pero "un paciente bajo otro" sugiere lista vertical. 
    // Sin embargo, las tablas médicas suelen ser anchas. Mantendré Landscape 'l' por seguridad de columnas.
    // Update: Mejor Landscape para que quepan las columnas de signos vitales.

    // Configuración inicial
    const pageWidth = 279; // Letter Landscape
    const pageHeight = 216;
    const margin = 14;
    let cursorY = 20;

    // Título Principal del Documento
    doc.setFillColor(13, 27, 42);
    doc.rect(0, 0, pageWidth, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text("Reporte Consolidado de Pacientes", margin, 12);
    doc.setFontSize(10);
    doc.text(`Generado el: ${new Date().toLocaleDateString()} | Filtro: ${document.getElementById('admin-puesto-filter').value}`, margin, 19);

    cursorY = 35; // Inicio contenido

    for (const [id, infoObj] of Object.entries(dataMap)) {
        if (!infoObj.info) continue;

        const p = infoObj.info;
        const historial = infoObj.visitas;

        // Calcular espacio necesario para cabecera paciente (aprox 15mm) + al menos 1 fila tabla (15mm)
        // Si no cabe, nueva página
        if (cursorY + 30 > pageHeight - margin) {
            doc.addPage();
            cursorY = 20;
        }

        // Sub-Cabecera del Paciente
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(`• Paciente: ${p.nombre}`, margin, cursorY);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(10);
        doc.text(`ID: ${p.dpi || id} | Puesto: ${p.puesto}`, margin + 100, cursorY);

        cursorY += 5; // Espacio entre titulo y tabla

        // Cuerpo tabla
        const body = historial.map(h => [h.fecha, h.diagnostico, h.pa, h.fc, h.fr, h.spo2, h.tratamiento, h.cambios, h.comentarios]);

        doc.autoTable({
            startY: cursorY,
            head: [['Fecha', 'Condición', 'PA', 'FC', 'FR', 'SpO2', 'Tratamiento', 'Cambios?', 'Obs']],
            body: body,
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [65, 90, 119] },
            columnStyles: {
                6: { cellWidth: 50 }, // Tratamiento más ancho
                8: { cellWidth: 40 }  // Obs más ancho
            },
            margin: { left: margin, right: margin },
            pageBreak: 'auto' // Permite romper tabla si es muy larga
        });

        // Actualizar cursor para el siguiente paciente
        cursorY = doc.lastAutoTable.finalY + 15; // 15mm de separación
    }

    doc.save("Reporte_Consolidado.pdf");
}

// NUEVO USUARIO
document.getElementById('register-user-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const nombre = document.getElementById('reg-nombre').value;
    const user = document.getElementById('reg-user').value;
    const pass = document.getElementById('reg-pass').value;
    const puesto = document.getElementById('reg-puesto').value;
    showLoading("Registrando...");
    postData({ action: 'registerUser', nombre: nombre, usuario: user, password: pass, puesto: puesto })
        .then(resp => {
            hideLoading();
            if (resp.success) {
                alert("¡Exito!"); document.getElementById('username').value = user;
                registerScreen.classList.remove('active'); loginScreen.classList.add('active');
            } else alert(resp.message);
        });
});
document.getElementById('btn-go-register').addEventListener('click', () => { loginScreen.classList.remove('active'); registerScreen.classList.add('active'); });
document.getElementById('btn-cancel-register').addEventListener('click', () => { registerScreen.classList.remove('active'); loginScreen.classList.add('active'); });

function handleError(err) { hideLoading(); console.error(err); alert("Error: " + err); }
function showLoading(t) { loadingText.innerText = t; loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }
async function postData(data) {
    const formData = new FormData(); for (const key in data) formData.append(key, data[key]);
    const response = await fetch(API_URL, { method: 'POST', body: formData });
    return response.json();
}
