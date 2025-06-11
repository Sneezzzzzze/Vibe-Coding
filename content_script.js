/**
 * Content script for KMITL Schedule Enhancer
 * Injected into pages matching the pattern in manifest.json.
 * Responsibilities:
 * 1. Extract schedule data from the KMITL schedule page.
 * 2. Send this data to the popup when requested.
 * 3. Inject UI elements for in-page interactions (theme toggle, TA management).
 */

console.log("KMITL Schedule Enhancer: Content script injected and attempting to run.");

const THEME_ENABLED_STORAGE_KEY = 'kmitlPlusThemeEnabled';
const THEME_DISABLED_BODY_CLASS = 'kmitl-plus-theme-disabled';

let currentEditingTaId = null; // Used for in-page editing of TA classes

// --- Storage and Utility Functions ---
async function fetchTaClassesFromStorage() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['taClasses'], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Content Script - Error fetching TA classes:", chrome.runtime.lastError.message);
        return reject(chrome.runtime.lastError);
      }
      const taClasses = Array.isArray(result.taClasses) ? result.taClasses : [];
      resolve(taClasses); // No console log here, will be logged by caller if needed
    });
  });
}

async function saveTaClassesToStorage(taClassesArray) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ taClasses: taClassesArray }, () => {
      if (chrome.runtime.lastError) {
        console.error("Content Script - Error saving TA classes:", chrome.runtime.lastError.message);
        return reject(chrome.runtime.lastError);
      }
      resolve(); // No console log here
    });
  });
}

function generateTrulyUniqueIdentifier() {
  return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
// --- End Storage and Utility Functions ---

/**
 * Parses the day/time string and room string to create schedule items for regular courses.
 */
function parseDayTimeRoom(dayTimeString, roomString, courseName, courseCode, theorySectionNum, labSectionNum) {
  const items = [];
  const dayTimeParts = dayTimeString.split(/<br\s*\/?>/i);
  const roomParts = roomString.split(/<br\s*\/?>/i);
  const dayMap = { "จ.": "Mon", "อ.": "Tue", "พ.": "Wed", "พฤ.": "Thu", "ศ.": "Fri", "ส.": "Sat", "อา.": "Sun", "จ": "Mon", "อ": "Tue", "พ": "Wed", "พฤ": "Thu", "ศ": "Fri", "ส": "Sat", "อา": "Sun"};

  for (let i = 0; i < dayTimeParts.length; i++) {
    const part = dayTimeParts[i].replace(/<font[^>]*>|<\/font>/gi, '').trim();
    const room = roomParts[i] ? roomParts[i].replace(/<font[^>]*>|<\/font>/gi, '').trim() : (roomParts[0] ? roomParts[0].replace(/<font[^>]*>|<\/font>/gi, '').trim() : '');
    if (part === '-' || !part) continue;

    const dayMatch = part.match(/([ก-ฮ]+.?)/u);
    const timeMatch = part.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
    const sessionTypeMatch = part.match(/\((ท|ป)\)/);
    const dayAbbr = dayMatch ? dayMatch[1].trim() : null;
    const day = dayAbbr ? (dayMap[dayAbbr] || dayAbbr) : "N/A";
    let timeRange = "N/A", startTime = "N/A", endTime = "N/A";
    if (timeMatch) {
        timeRange = `${timeMatch[1]}-${timeMatch[2]}`;
        startTime = timeMatch[1];
        endTime = timeMatch[2];
    }
    let sessionTypeSymbol = "";
    let sectionNumber = "";
    if (sessionTypeMatch) {
      sessionTypeSymbol = sessionTypeMatch[1];
      sectionNumber = (sessionTypeSymbol === 'ท') ? (theorySectionNum || "") : (labSectionNum || "");
    } else {
      sectionNumber = theorySectionNum || labSectionNum || "";
    }

    if (day !== "N/A" && timeRange !== "N/A") {
      items.push({
        id: generateTrulyUniqueIdentifier(),
        day: day, timeRange: timeRange, startTime: startTime, endTime: endTime,
        subject: courseName, room: room, type: 'regular', courseCode: courseCode,
        sectionNumber: sectionNumber, sessionTypeSymbol: sessionTypeSymbol
      });
    }
  }
  return items;
}

/**
 * Extracts schedule data from the KMITL schedule page.
 */
function extractScheduleDataFromPage() {
  const scheduleItems = [];
  let scheduleTable = null;
  const tablesByWidth = document.querySelectorAll('table[width="1258"]');
  if (tablesByWidth.length === 1) scheduleTable = tablesByWidth[0];
  else if (tablesByWidth.length > 1) scheduleTable = tablesByWidth[1];

  if (!scheduleTable) {
    const allTables = document.querySelectorAll('table');
    const keywords = ["รหัสวิชา", "ชื่อวิชา", "หน่วยกิต", "วัน-เวลาเรียน"];
    for (let table of allTables) {
      if (keywords.every(kw => (table.innerText || "").includes(kw))) {
        scheduleTable = table; break;
      }
    }
  }
  if (!scheduleTable) { return []; }

  const rows = scheduleTable.querySelectorAll('tbody tr');
  rows.forEach((row, rowIndex) => {
    if (rowIndex < 1 || row.innerText.toLowerCase().includes('รหัสวิชา') || row.cells.length < 15) return;
    const cells = row.querySelectorAll('td');
    const courseCode = cells[2]?.innerText.trim();
    const courseName = cells[4]?.innerText.trim();
    const theorySectionNumStr = cells[8]?.innerText.trim();
    const labSectionNumStr = cells[10]?.innerText.trim();
    const dayTimeString = cells[12]?.innerHTML.trim();
    const roomString = cells[14]?.innerHTML.trim();

    if (courseCode && courseName && dayTimeString && roomString && courseCode !== '-' && courseName !== '-') {
      try {
        const items = parseDayTimeRoom(dayTimeString, roomString, courseName, courseCode, theorySectionNumStr, labSectionNumStr);
        scheduleItems.push(...items);
      } catch (e) { console.error(`CS: Error parsing row for ${courseCode}:`, e); }
    }
  });
  return scheduleItems;
}

// --- In-Page UI Rendering and Interactions ---

function renderScheduleItemCard(itemData) {
  const colors = ['#14b8a6', '#3b82f6', '#0ea5e9', '#a855f7', '#eab308', '#f43f5e', '#f59e0b', '#10b981', '#f97316', '#06b6d4'];
  let colorIndex = 0;
  const keyForColor = itemData.courseCode || itemData.subject || '';
  for (let i = 0; i < keyForColor.length; i++) {
    colorIndex = (colorIndex + keyForColor.charCodeAt(i)) % colors.length;
  }
  const cardBackgroundColor = itemData.type === 'TA' ? '#6c757d' : colors[colorIndex];

  const cardDiv = document.createElement('div');
  cardDiv.className = 'schedule-item-card';
  cardDiv.style.backgroundColor = cardBackgroundColor;
  cardDiv.style.color = 'white'; cardDiv.style.padding = '4px';
  cardDiv.style.position = 'relative'; cardDiv.style.borderRadius = '3px';
  cardDiv.style.overflow = 'hidden';
  cardDiv.dataset.itemId = itemData.id; cardDiv.dataset.itemType = itemData.type;

  const roomP = document.createElement('p'); roomP.className = 'card-room'; roomP.textContent = itemData.room || '';
  const subjectP = document.createElement('p'); subjectP.className = 'card-subject';
  subjectP.textContent = itemData.subject;
  if (itemData.type === 'TA' && !itemData.subject.toLowerCase().includes('(ta')) subjectP.textContent += " (TA)";

  let sectionText = '';
  if (itemData.sectionNumber && itemData.sectionNumber.toLowerCase() !== 'n/a') {
    if (itemData.type === 'TA' && itemData.sectionNumber.toLowerCase() === 'ta') sectionText = 'TA Session';
    else {
      sectionText = `Section ${itemData.sectionNumber}`;
      if (itemData.sessionTypeSymbol && itemData.sessionTypeSymbol.trim() !== '') sectionText += ` (${itemData.sessionTypeSymbol})`;
    }
  }
  const sectionP = document.createElement('p'); sectionP.className = 'card-section'; sectionP.textContent = sectionText;
  const timeP = document.createElement('p'); timeP.className = 'card-time'; timeP.textContent = itemData.timeRange;

  cardDiv.appendChild(roomP); cardDiv.appendChild(subjectP);
  cardDiv.appendChild(sectionP); cardDiv.appendChild(timeP);
  return cardDiv;
}

function renderScheduleGrid(allScheduleData) {
  const gridContainer = document.getElementById('kmitl-plus-schedule-grid-container');
  if (!gridContainer) { console.error("CS: Grid container not found!"); return; }
  gridContainer.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'kmitl-plus-grid-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const thDay = document.createElement('th');
  thDay.className = 'grid-time-header grid-day-column-header'; thDay.textContent = 'Day';
  headerRow.appendChild(thDay);

  const timeSlots = [ "08:00-09:00", "09:00-10:00", "10:00-11:00", "11:00-12:00", "12:00-13:00", "13:00-14:00", "14:00-15:00", "15:00-16:00", "16:00-17:00", "17:00-18:00", "18:00-19:00", "19:00-20:00" ];
  timeSlots.forEach(slot => {
    const thTime = document.createElement('th');
    thTime.className = 'grid-time-header'; thTime.setAttribute('colspan', '4');
    thTime.textContent = slot.replace('-', ' - ');
    headerRow.appendChild(thTime);
  });
  thead.appendChild(headerRow); table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dayToRenderProofOfConcept = "Mon";

  days.forEach(dayAbbr => {
    const dayRow = document.createElement('tr'); dayRow.className = 'grid-day-row';
    const tdDayLabel = document.createElement('td'); tdDayLabel.className = 'grid-day-label';
    tdDayLabel.textContent = dayAbbr; dayRow.appendChild(tdDayLabel);

    const dayScheduleCell = document.createElement('td');
    dayScheduleCell.className = 'grid-day-schedule-cell';
    dayScheduleCell.setAttribute('colspan', (timeSlots.length * 4).toString());
    dayRow.appendChild(dayScheduleCell);

    if (dayAbbr === dayToRenderProofOfConcept) { // Only render Monday for POC
        const itemsForThisDay = allScheduleData.filter(item => item.day === dayAbbr);
        itemsForThisDay.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

        if (itemsForThisDay.length > 0) {
            itemsForThisDay.forEach(item => {
                const cardElement = renderScheduleItemCard(item);
                dayScheduleCell.appendChild(cardElement);
            });
        }
    }
    tbody.appendChild(dayRow);
  });
  table.appendChild(tbody); gridContainer.appendChild(table);
  console.log(`CS: Rendered grid structure with items for ${dayToRenderProofOfConcept}.`);
}

function renderTaClassesOnPage(taClassesArray) { // This function might be deprecated or merged into renderScheduleGrid
  let taContainer = document.getElementById('custom-ta-classes-container');
  if (taContainer) taContainer.innerHTML = '';
  else {
    taContainer = document.createElement('div'); taContainer.id = 'custom-ta-classes-container';
    let refTable = document.querySelector('table[width="1258"]');
    if(document.querySelectorAll('table[width="1258"]').length > 1) refTable = document.querySelectorAll('table[width="1258"]')[1];
    const referenceNode = refTable || document.querySelector('center') || document.body;
    referenceNode.parentNode.insertBefore(taContainer, referenceNode.nextSibling || null);
  }
  const title = document.createElement('h3'); title.textContent = 'TA Classes (Legacy Display)';
  taContainer.appendChild(title);
  if (!taClassesArray || taClassesArray.length === 0) {
    const p = document.createElement('p'); p.textContent = 'No TA classes added yet.';
    taContainer.appendChild(p); return;
  }
  const ul = document.createElement('ul');
  taClassesArray.forEach(taClass => {
    const li = document.createElement('li');
    const contentDiv = document.createElement('div');
    let taSpecificInfo = ` (TA${taClass.sectionNumber && taClass.sectionNumber !== 'TA' ? ` - Section ${taClass.sectionNumber}` : ''})`;
    contentDiv.innerHTML = `<strong>${taClass.subject || 'N/A'}</strong>${taSpecificInfo}<br>Day: ${taClass.day || 'N/A'}, Time: ${taClass.timeRange || 'N/A'}<br>Room: ${taClass.room || 'N/A'}`;
    li.appendChild(contentDiv);
    const controlsDiv = document.createElement('div'); controlsDiv.className = 'ta-item-controls';
    const editBtn = document.createElement('button'); editBtn.className = 'ta-edit-btn'; editBtn.textContent = 'Edit'; editBtn.dataset.id = taClass.id;
    const delBtn = document.createElement('button'); delBtn.className = 'ta-delete-btn'; delBtn.textContent = 'Delete'; delBtn.dataset.id = taClass.id;
    controlsDiv.appendChild(editBtn); controlsDiv.appendChild(delBtn);
    li.appendChild(controlsDiv); li.dataset.taClassId = taClass.id;
    ul.appendChild(li);
  });
  taContainer.appendChild(ul);
}

function injectAddTaButtonAndForm() {
  if (document.getElementById('inpage-add-ta-button')) return;
  const addButton = document.createElement('button');
  addButton.id = 'inpage-add-ta-button'; addButton.textContent = 'Add New TA Class';
  const formContainer = document.createElement('div');
  formContainer.id = 'inpage-ta-form-container'; formContainer.style.display = 'none';
  formContainer.innerHTML = `<h3>Add / Edit TA Class</h3>
    <div><label for="inpage-ta-subject">Subject:</label><input type="text" id="inpage-ta-subject" required></div>
    <div><label for="inpage-ta-day">Day:</label><select id="inpage-ta-day">
    <option value="Mon">Monday</option><option value="Tue">Tuesday</option><option value="Wed">Wednesday</option><option value="Thu">Thursday</option><option value="Fri">Friday</option><option value="Sat">Saturday</option><option value="Sun">Sunday</option></select></div>
    <div><label for="inpage-ta-time">Time (HH:MM-HH:MM):</label><input type="text" id="inpage-ta-time" required placeholder="09:00-12:00"></div>
    <div><label for="inpage-ta-room">Room:</label><input type="text" id="inpage-ta-room"></div>
    <button type="button" id="inpage-ta-save-button">Save TA Class</button><button type="button" id="inpage-ta-cancel-button">Cancel</button>`;
  document.body.appendChild(addButton); document.body.appendChild(formContainer);

  addButton.addEventListener('click', () => {
    currentEditingTaId = null; formContainer.style.display = 'block';
    document.getElementById('inpage-ta-subject').value = ''; document.getElementById('inpage-ta-day').value = 'Mon';
    document.getElementById('inpage-ta-time').value = ''; document.getElementById('inpage-ta-room').value = '';
    formContainer.querySelector('h3').textContent = 'Add New TA Class';
    formContainer.querySelector('#inpage-ta-save-button').textContent = 'Save TA Class';
  });
  formContainer.querySelector('#inpage-ta-cancel-button').addEventListener('click', () => formContainer.style.display = 'none');
  formContainer.querySelector('#inpage-ta-save-button').addEventListener('click', async () => {
    const subject = document.getElementById('inpage-ta-subject').value.trim();
    const day = document.getElementById('inpage-ta-day').value;
    const time = document.getElementById('inpage-ta-time').value.trim();
    const room = document.getElementById('inpage-ta-room').value.trim();
    if (!subject || !day || !time) { alert("Fill Subject, Day, and Time."); return; }
    if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(time)) { alert("Invalid time. Use HH:MM-HH:MM."); return; }
    try {
      let classes = await fetchTaClassesFromStorage(); const timeParts = time.split('-');
      if (currentEditingTaId) {
        const idx = classes.findIndex(c => c.id === currentEditingTaId);
        if (idx > -1) {
          classes[idx] = {...classes[idx], id: currentEditingTaId, subject, day,
            timeRange: time, startTime: timeParts[0]?.trim(), endTime: timeParts[1]?.trim(),
            room, type: 'TA',
            sectionNumber: classes[idx].sectionNumber || 'TA',
            sessionTypeSymbol: classes[idx].sessionTypeSymbol || ''
          };
          alert("TA Class updated.");
        } else { alert("Error: TA to update not found."); currentEditingTaId = null; return; }
      } else {
        classes.push({id: generateTrulyUniqueIdentifier(), subject, day,
            timeRange: time, startTime: timeParts[0]?.trim(), endTime: timeParts[1]?.trim(),
            room, type: 'TA', courseCode: '', sectionNumber: 'TA', sessionTypeSymbol: ''});
        alert("TA Class added.");
      }
      await saveTaClassesToStorage(classes);
      // If theme is enabled, render the grid. Otherwise, the old TA list.
      if (!document.body.classList.contains(THEME_DISABLED_BODY_CLASS)) {
        const regularScheduleData = extractScheduleDataFromPage();
        const allScheduleData = [...regularScheduleData, ...classes];
        const dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "N/A"];
        allScheduleData.sort((a, b) => {
            const dayIndexA = dayOrder.indexOf(a.day); const dayIndexB = dayOrder.indexOf(b.day);
            if (dayIndexA !== dayIndexB) return dayIndexA - dayIndexB;
            return (a.startTime || "").localeCompare(b.startTime || "");
        });
        renderScheduleGrid(allScheduleData);
      } else {
        renderTaClassesOnPage(classes);
      }
      formContainer.style.display = 'none'; currentEditingTaId = null;
    } catch (e) { console.error("Error saving TA:", e); alert("Failed to save. See console."); if(currentEditingTaId) currentEditingTaId = null; }
  });
}

function setupTaItemActionListeners() {
  const taContainer = document.getElementById('custom-ta-classes-container');
  if (taContainer && !taContainer.dataset.listenersAttached) {
    taContainer.addEventListener('click', async (event) => {
      const target = event.target;
      if (target.classList.contains('ta-edit-btn')) {
        const taId = target.dataset.id; if (!taId) return;
        currentEditingTaId = taId;
        try {
          const taClasses = await fetchTaClassesFromStorage();
          const taToEdit = taClasses.find(ta => ta.id === taId);
          if (taToEdit) {
            document.getElementById('inpage-ta-subject').value = taToEdit.subject;
            document.getElementById('inpage-ta-day').value = taToEdit.day;
            document.getElementById('inpage-ta-time').value = taToEdit.timeRange || '';
            document.getElementById('inpage-ta-room').value = taToEdit.room || '';
            const form = document.getElementById('inpage-ta-form-container');
            form.querySelector('h3').textContent = 'Edit TA Class';
            form.querySelector('#inpage-ta-save-button').textContent = 'Update TA Class';
            form.style.display = 'block';
          } else { alert("Error: TA to edit not found."); currentEditingTaId = null; }
        } catch (e) { console.error("Error preparing TA edit:", e); currentEditingTaId = null; alert("Error. See console."); }
      } else if (target.classList.contains('ta-delete-btn')) {
        const taId = target.dataset.id; if (!taId || !window.confirm("Delete TA class?")) return;
        try {
          let classes = await fetchTaClassesFromStorage();
          const initialLen = classes.length;
          classes = classes.filter(c => c.id !== taId);
          if (classes.length < initialLen) {
            await saveTaClassesToStorage(classes);
            // If theme is enabled, render the grid. Otherwise, the old TA list.
            if (!document.body.classList.contains(THEME_DISABLED_BODY_CLASS)) {
                const regularScheduleData = extractScheduleDataFromPage();
                const allScheduleData = [...regularScheduleData, ...classes];
                 const dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "N/A"];
                allScheduleData.sort((a, b) => {
                    const dayIndexA = dayOrder.indexOf(a.day); const dayIndexB = dayOrder.indexOf(b.day);
                    if (dayIndexA !== dayIndexB) return dayIndexA - dayIndexB;
                    return (a.startTime || "").localeCompare(b.startTime || "");
                });
                renderScheduleGrid(allScheduleData);
            } else {
                renderTaClassesOnPage(classes);
            }
            alert("TA Class deleted.");
          } else { alert("Error: TA to delete not found."); }
        } catch (e) { console.error("Error deleting TA:", e); alert("Failed to delete. See console."); }
      }
    });
    taContainer.dataset.listenersAttached = 'true';
  }
}

function injectThemeToggleButton(initialStateIsThemed) {
  if (document.getElementById('kmitl-theme-toggle-button')) return;
  const btn = document.createElement('button'); btn.id = 'kmitl-theme-toggle-button';
  const updateTxt = (isThemed) => { btn.textContent = isThemed ? 'View Original Design' : 'View KMITL+ Theme'; };
  updateTxt(initialStateIsThemed);
  btn.addEventListener('click', async () => {
    const isThemed = !document.body.classList.contains(THEME_DISABLED_BODY_CLASS);
    const newState = !isThemed;
    document.body.classList.toggle(THEME_DISABLED_BODY_CLASS, !newState); updateTxt(newState);
    try { await chrome.storage.local.set({ [THEME_ENABLED_STORAGE_KEY]: newState }); }
    catch (e) { console.error('Error saving theme state:', e); }
    // Re-initialize features to apply/remove grid based on new theme state
    initializeExtensionFeatures();
  });
  document.body.appendChild(btn);
}

async function initializeExtensionFeatures() {
  console.log("CS: Initializing features.");
  let themeEnabled = true;
  try {
    const r = await chrome.storage.local.get([THEME_ENABLED_STORAGE_KEY]);
    if (r[THEME_ENABLED_STORAGE_KEY] !== undefined) themeEnabled = r[THEME_ENABLED_STORAGE_KEY];
  } catch (e) { console.error('Error loading theme state:', e); }
  document.body.classList.toggle(THEME_DISABLED_BODY_CLASS, !themeEnabled);

  let origTable = document.querySelector('table[width="1258"]');
  if(!origTable || document.querySelectorAll('table[width="1258"]').length > 1) {
      const tables = document.querySelectorAll('table[width="1258"]');
      if(tables.length > 1) origTable = tables[1];
      else if (tables.length === 1 && !origTable) origTable = tables[0];
  }
   if (!origTable) {
        const allTables = document.querySelectorAll('table');
        const keywords = ["รหัสวิชา", "ชื่อวิชา", "หน่วยกิต", "วัน-เวลาเรียน"];
        for (let table of allTables) { if (keywords.every(kw => (table.innerText || "").includes(kw))) { origTable = table; break; } }
    }

  const gridContainerId = 'kmitl-plus-schedule-grid-container';
  let gridContainer = document.getElementById(gridContainerId);

  if (themeEnabled) {
    if (origTable) origTable.style.setProperty('display', 'none', 'important');
    if (!gridContainer) {
      gridContainer = document.createElement('div'); gridContainer.id = gridContainerId;
      if (origTable && origTable.parentNode) origTable.parentNode.insertBefore(gridContainer, origTable);
      else document.body.appendChild(gridContainer);
    }
    gridContainer.style.display = '';

    // Render KMITL+ Grid
    const regularScheduleData = extractScheduleDataFromPage();
    const taClasses = await fetchTaClassesFromStorage(); // fetch TA classes
    const allScheduleData = [...regularScheduleData, ...taClasses];
    const dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "N/A"];
    allScheduleData.sort((a, b) => {
        const dayIndexA = dayOrder.indexOf(a.day); const dayIndexB = dayOrder.indexOf(b.day);
        if (dayIndexA !== dayIndexB) return dayIndexA - dayIndexB;
        return (a.startTime || "").localeCompare(b.startTime || "");
    });
    renderScheduleGrid(allScheduleData);

    // Hide old TA list container if it exists
    const oldTaContainer = document.getElementById('custom-ta-classes-container');
    if (oldTaContainer) oldTaContainer.style.display = 'none';

  } else {
    if (origTable) origTable.style.display = '';
    if (gridContainer) gridContainer.style.display = 'none';

    // Show old TA list container if theme is disabled (and it exists)
    const oldTaContainer = document.getElementById('custom-ta-classes-container');
    if (oldTaContainer) oldTaContainer.style.display = ''; // Make sure it's visible
    else { // If it doesn't exist, render it (e.g., first time after disabling theme)
        const taClasses = await fetchTaClassesFromStorage();
        renderTaClassesOnPage(taClasses);
    }
  }

  // Common UI elements (buttons, forms) - inject if not present
  injectAddTaButtonAndForm();
  injectThemeToggleButton(themeEnabled);
  setupTaItemActionListeners(); // Sets up listeners on #custom-ta-classes-container
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeExtensionFeatures);
} else {
  initializeExtensionFeatures();
}

// Listen for messages from popup (if any, e.g., refresh request)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getScheduleData") {
    console.log("CS: 'getScheduleData' received from popup.");
    try {
      const data = extractScheduleDataFromPage(); // This should be the raw KMITL data
      sendResponse({ status: "success", data: data });
    } catch (error) {
      sendResponse({ status: "error", message: "Failed to extract data: " + error.message });
    }
    return true;
  } else if (request.action === "refreshTaClassesDisplay") { // New message for TA class updates
    console.log("CS: 'refreshTaClassesDisplay' received.");
    initializeExtensionFeatures(); // Re-run init to refresh displays
    sendResponse({status: "success"});
    return true;
  }
  return false;
});
