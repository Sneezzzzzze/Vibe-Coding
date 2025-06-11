/**
 * Content script for KMITL Schedule Enhancer
 * Injected into pages matching the pattern in manifest.json.
 * Responsibilities:
 * 1. Extract schedule data from the KMITL schedule page.
 * 2. Send this data to the popup when requested.
 */

console.log("KMITL Schedule Enhancer: Content script injected and attempting to run.");

const THEME_ENABLED_STORAGE_KEY = 'kmitlPlusThemeEnabled';
const THEME_DISABLED_BODY_CLASS = 'kmitl-plus-theme-disabled';

let currentEditingTaId = null;

// --- Storage and Utility Functions ---
async function fetchTaClassesFromStorage() { // Changed to async function for direct use with await
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['taClasses'], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Content Script - Error fetching TA classes:", chrome.runtime.lastError.message);
        return reject(chrome.runtime.lastError);
      }
      const taClasses = Array.isArray(result.taClasses) ? result.taClasses : [];
      console.log("Content Script - Fetched TA classes:", taClasses);
      resolve(taClasses);
    });
  });
}

async function saveTaClassesToStorage(taClassesArray) { // Changed to async function
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ taClasses: taClassesArray }, () => {
      if (chrome.runtime.lastError) {
        console.error("Content Script - Error saving TA classes:", chrome.runtime.lastError.message);
        return reject(chrome.runtime.lastError);
      }
      console.log("Content Script - TA classes saved successfully.");
      resolve();
    });
  });
}

function generateTrulyUniqueIdentifier() {
  return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
// --- End Storage and Utility Functions ---

/**
 * Parses the day/time string and room string to create schedule items.
 * @param {string} dayTimeString - Raw string like "ศ. 09:00-11:00 น.(ท)<br><font color="#FF6600">ศ. 11:00-13:00 น.(ป)</font>"
 * @param {string} roomString - Raw string like "L306<br><font color="#FF6600">L306</font>"
 * @param {string} courseName - The name of the course.
 * @param {string} courseCode - The code of the course.
 * @returns {Array<Object>} An array of schedule item objects.
 */
function parseDayTimeRoom(dayTimeString, roomString, courseName, courseCode) {
  const items = [];
  const dayTimeParts = dayTimeString.split(/<br\s*\/?>/i);
  const roomParts = roomString.split(/<br\s*\/?>/i);

  const dayMap = {
    "จ.": "Mon", "อ.": "Tue", "พ.": "Wed", "พฤ.": "Thu", "ศ.": "Fri", "ส.": "Sat", "อา.": "Sun",
    "จ": "Mon", "อ": "Tue", "พ": "Wed", "พฤ": "Thu", "ศ": "Fri", "ส": "Sat", "อา": "Sun" // Handle cases without dot
  };

  for (let i = 0; i < dayTimeParts.length; i++) {
    const part = dayTimeParts[i].replace(/<font[^>]*>|<\/font>/gi, '').trim(); // Remove font tags
    const room = roomParts[i] ? roomParts[i].replace(/<font[^>]*>|<\/font>/gi, '').trim() : (roomParts[0] ? roomParts[0].replace(/<font[^>]*>|<\/font>/gi, '').trim() : ''); // Fallback to first room if not enough room parts

    if (part === '-' || !part) continue; // Skip if part is just a dash or empty

    const dayMatch = part.match(/([ก-ฮ]+.?)/u);
    const timeMatch = part.match(/(\d{2}:\d{2}-\d{2}:\d{2})/);
    const sessionTypeMatch = part.match(/\((ท|ป)\)/); // (ท) for Theory, (ป) for Lab

    const dayAbbr = dayMatch ? dayMatch[1].trim() : null;
    const day = dayAbbr ? (dayMap[dayAbbr] || dayAbbr) : "N/A"; // Convert to English or keep original if not found
    const time = timeMatch ? timeMatch[1] : "N/A";

    let subjectWithSessionType = courseName;
    if (sessionTypeMatch) {
      const type = sessionTypeMatch[1] === 'ท' ? '(Theory)' : '(Lab)';
      subjectWithSessionType = `${courseName} ${type}`;
    }

    if (day !== "N/A" && time !== "N/A") {
      items.push({
        day: day,
        time: time,
        subject: subjectWithSessionType,
        room: room,
        type: 'regular',
        courseCode: courseCode
      });
    } else {
      console.warn(`Content Script: Could not parse day/time from: "${part}" for course ${courseCode}`);
    }
  }
  return items;
}


/**
 * Extracts schedule data from the KMITL schedule page.
 * @returns {Array<Object>} An array of schedule item objects.
 */
function extractScheduleDataFromPage() {
  console.log("Content Script: extractScheduleDataFromPage() called.");
  const scheduleItems = [];
  let scheduleTable = null;

  // Primary attempt: Select tables with width="1258"
  const tablesByWidth = document.querySelectorAll('table[width="1258"]');
  if (tablesByWidth.length === 1) {
    scheduleTable = tablesByWidth[0];
    console.log("Content Script: Primary selector found one table with width='1258'.");
  } else if (tablesByWidth.length > 1) {
    scheduleTable = tablesByWidth[1]; // Often the second one is the main data table
    console.log("Content Script: Primary selector found multiple tables with width='1258', selecting the second one.");
  }

  if (scheduleTable) {
    console.log("Content Script: Successfully identified schedule table using primary selector (width='1258').");
  } else {
    console.warn("Content Script: Primary selector (width='1258') failed to find a suitable schedule table. Attempting fallback.");
    const allTables = document.querySelectorAll('table');
    const headerKeywords = ["รหัสวิชา", "ชื่อวิชา", "หน่วยกิต", "วัน-เวลาเรียน"];

    for (let i = 0; i < allTables.length; i++) {
      const currentTable = allTables[i];
      const firstFewRows = Array.from(currentTable.getElementsByTagName('tr')).slice(0, 5); // Check first 5 rows
      let foundInThisTable = false;

      for (let j = 0; j < firstFewRows.length; j++) {
        const row = firstFewRows[j];
        const cells = row.querySelectorAll('td, th');
        let rowText = "";
        cells.forEach(cell => {
          rowText += cell.innerText.trim() + " ";
        });

        let matchedKeywords = 0;
        headerKeywords.forEach(keyword => {
          if (rowText.includes(keyword)) {
            matchedKeywords++;
          }
        });

        // If at least 3 of the 4 keywords are found in a row, consider this the table
        if (matchedKeywords >= 3) {
          scheduleTable = currentTable;
          console.log(`Content Script: Fallback successful. Found schedule table by header content (matched ${matchedKeywords} keywords in row ${j + 1} of table ${i + 1}).`);
          foundInThisTable = true;
          break;
        }
      }
      if (foundInThisTable) break;
    }

    if (!scheduleTable) {
      console.error("Content Script: Both primary and fallback methods failed to identify the schedule table. Cannot extract data.");
      return [];
    }
  }

  const rows = scheduleTable.querySelectorAll('tbody tr'); // Prefer querySelectorAll for consistency
  console.log(`Content Script: Found ${rows.length} rows in the identified schedule table.`);

  rows.forEach((row, rowIndex) => {
    // Skip header rows - typical headers contain 'รหัสวิชา', 'ชื่อวิชา', or are very short.
    // Also skip rows that are clearly not data rows based on cell count or content.
    const headerCheckText = row.innerText.toLowerCase();
    if (rowIndex < 1 || headerCheckText.includes('รหัสวิชา') || headerCheckText.includes('ชื่อวิชา') || row.cells.length < 8) {
      console.log(`Content Script: Skipping row ${rowIndex} (likely header or irrelevant). Text: ${headerCheckText}`);
      return;
    }

    const cells = row.querySelectorAll('td');
    // Ensure cells are properly selected and have content.
    // The indices are based on visual inspection of typical KMITL schedule HTML structure.
    // Column 0: sequence number
    // Column 1: course code (รหัสวิชา)
    // Column 2: course name (ชื่อวิชา)
    // Column 3: credits (หน่วยกิต)
    // Column 4: Midterm Date/Time (วันเวลาสอบกลางภาค) - may contain colspan
    // Column 5: Final Date/Time (วันเวลาสอบปลายภาค) - may contain colspan
    // Column 6: Day/Time (วัน-เวลาเรียน)
    // Column 7: Room (ห้องเรียน)
    // Column 8: Lecturer (ผู้สอน)

    // Adjust for potential colspans in exam date cells, which might shift day/time/room indices
    let courseCodeCellIndex = 2;
    let courseNameCellIndex = 4;
    let dayTimeCellIndex = 12;
    let roomCellIndex = 14;

    // A simple check for colspans affecting indices. If a cell has colspan, subsequent indices might shift.
    // This is a basic heuristic. A more robust way would be to count actual distinct data cells.
    if (cells[4] && cells[4].getAttribute('colspan')) {
        const colspanVal = parseInt(cells[4].getAttribute('colspan'), 10);
        if (colspanVal > 1) { // if midterm cell spans multiple columns
            // This logic might need refinement if both midterm and final have colspans
            // or if the structure varies significantly.
            // For now, assume if cells[4] has colspan, it pushes dayTime and room.
        }
    }
     // A more direct way: find cells by expected content if indices are unreliable
     // For now, we stick to indices and adjust if clearly needed.
     // Let's assume the critical cells are:
     // cells[1] = course code, cells[2] = course name, cells[6] = day/time, cells[7] = room
     // This needs to be verified with actual HTML. If colspans are common before day/time, indices shift.

    if (cells.length > 7) { // Ensure enough cells exist
      const courseCode = cells[courseCodeCellIndex]?.innerText.trim();
      const courseName = cells[courseNameCellIndex]?.innerText.trim();
      const dayTimeString = cells[dayTimeCellIndex]?.innerHTML.trim(); // Use innerHTML for <br> and <font> tags
      const roomString = cells[roomCellIndex]?.innerHTML.trim(); // Use innerHTML

      if (courseCode && courseName && dayTimeString && roomString && courseCode !== '-' && courseName !== '-') {
        console.log(`Content Script: Processing row ${rowIndex}: Code: ${courseCode}, Name: ${courseName}, Day/Time: "${dayTimeString}", Room: "${roomString}"`);
        try {
          const items = parseDayTimeRoom(dayTimeString, roomString, courseName, courseCode);
          scheduleItems.push(...items);
        } catch (e) {
          console.error(`Content Script: Error parsing day/time/room for ${courseCode} - ${courseName}:`, e);
        }
      } else {
        console.warn(`Content Script: Skipped row ${rowIndex} due to missing critical data (Code: ${courseCode}, Name: ${courseName}, Day/Time: ${dayTimeString}, Room: ${roomString}).`);
      }
    } else {
      console.warn(`Content Script: Skipped row ${rowIndex} because it has less than 8 cells (${cells.length}). Content: ${row.innerText}`);
    }
  });

  if (scheduleItems.length === 0) {
    console.warn("Content Script: No schedule data extracted from the page. The page might not be a KMITL schedule, or the structure has changed.");
  } else {
    console.log(`Content Script: Successfully extracted ${scheduleItems.length} schedule items.`);
  }
  return scheduleItems;
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content Script: Received message from popup:", request);
  if (request.action === "getScheduleData") {
    console.log("Content Script: Action 'getScheduleData' received.");
    try {
      const data = extractScheduleDataFromPage();
      if (data && data.length > 0) {
        console.log("Content Script: Sending SUCCESS response with data:", data);
        sendResponse({ status: "success", data: data });
      } else {
        console.warn("Content Script: No data extracted or mock data is empty. Sending EMPTY response.");
        sendResponse({ status: "success", data: [] }); // Send empty array if nothing found
      }
    } catch (error) {
      console.error("Content Script: Error in extractScheduleDataFromPage or during message response:", error);
      sendResponse({ status: "error", message: "Failed to extract data: " + error.message });
    }
    // For synchronous sendResponse, returning false or undefined is fine.
    // If extractScheduleDataFromPage were to become truly asynchronous (e.g. using fetch within it),
    // then `return true;` would be necessary here to keep the message channel open.
    return false;
  }
  // Default return false for synchronous message handling if no specific action matched.
  return false;
});

console.log("KMITL Schedule Enhancer: Content script listener set up.");

// ----- Basic Test Instructions (for developers) -----
//
// How to Load the Extension in Developer Mode:
// 1. Open Chrome and navigate to `chrome://extensions`.
// 2. Enable "Developer mode" using the toggle switch (usually in the top right).
// 3. Click "Load unpacked".
// 4. Select the directory where your extension files (manifest.json, etc.) are located.
//
// Adapting for the Actual KMITL Page:
// - The core logic for scraping is in the `extractScheduleDataFromPage()` function in this file (`content_script.js`).
// - You need to:
//   a. Inspect the HTML structure of the KMITL schedule page.
//   b. Identify the HTML elements (tags, classes, IDs) that contain the schedule information (day, time, subject, room).
//   c. Modify the placeholder `document.querySelectorAll` (or similar DOM manipulation methods)
//      within `extractScheduleDataFromPage()` to correctly select and extract this information.
//   d. Ensure the extracted data is formatted into an array of objects, where each object is like:
//      `{ day: "Mon", time: "09:00-12:00", subject: "Subject Name", room: "Room_Number", type: "regular" }`
//   e. Remove or comment out the mock data once your scraping logic works.
//
// Checking Consoles:
// - Popup Console: Right-click on the extension icon, then "Inspect popup". Go to the "Console" tab.
// - Content Script Console: On the KMITL schedule page (or any page where the content script is injected),
//   open the browser's developer tools (usually F12 or right-click -> Inspect) and go to the "Console" tab.
//   Ensure the console context is set to the page itself, not "top" or another frame, to see content script logs.
//   Content script logs are usually prefixed (e.g., "Content Script: ...").
//
// ----------------------------------------------------

function renderTaClassesOnPage(taClassesArray) {
  const existingContainer = document.getElementById('custom-ta-classes-container');
  if (existingContainer) {
    existingContainer.innerHTML = ''; // Clear previous TA classes if re-rendering
  }

  let taContainer = existingContainer;
  if (!taContainer) {
    taContainer = document.createElement('div');
    taContainer.id = 'custom-ta-classes-container';
    // Basic styling - can be enhanced via page_theme.css or specific CSS rules here
    taContainer.style.marginTop = '20px';
    taContainer.style.padding = '15px';
    taContainer.style.border = '1px solid #ddd';
    taContainer.style.borderRadius = '8px';
    taContainer.style.backgroundColor = '#f9f9f9';
    taContainer.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';


    // Try to insert it after the main schedule table, or fallback to end of body
    // Adjusted selector to be more robust based on previous table identification logic
    let mainScheduleTable;
    const tablesByWidth = document.querySelectorAll('table[width="1258"]');
    if (tablesByWidth.length === 1) mainScheduleTable = tablesByWidth[0];
    else if (tablesByWidth.length > 1) mainScheduleTable = tablesByWidth[1];

    if (!mainScheduleTable) { // Fallback if width="1258" not found
        const allTables = document.querySelectorAll('table');
        const headerKeywords = ["รหัสวิชา", "ชื่อวิชา", "หน่วยกิต", "วัน-เวลาเรียน"];
        for (let table of allTables) {
            const firstFewRows = Array.from(table.getElementsByTagName('tr')).slice(0, 5);
            let found = false;
            for (let row of firstFewRows) {
                const rowText = row.innerText || "";
                let matchedKeywords = 0;
                headerKeywords.forEach(kw => { if (rowText.includes(kw)) matchedKeywords++; });
                if (matchedKeywords >=3) { mainScheduleTable = table; found = true; break; }
            }
            if (found) break;
        }
    }

    const referenceNode = mainScheduleTable || document.querySelector('center'); // Fallback further to center tag or body
    if (referenceNode && referenceNode.parentNode) {
      // Insert after the identified table or center tag that usually wraps the schedule
      referenceNode.parentNode.insertBefore(taContainer, referenceNode.nextSibling);
    } else {
      document.body.appendChild(taContainer); // Absolute fallback
    }
  }

  const title = document.createElement('h3');
  title.textContent = 'TA Classes (From Extension)';
  title.style.marginTop = '0';
  title.style.marginBottom = '10px';
  title.style.color = '#333';
  title.style.borderBottom = '1px solid #eee';
  title.style.paddingBottom = '5px';
  taContainer.appendChild(title);


  if (!taClassesArray || taClassesArray.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No TA classes added yet.';
    p.style.fontStyle = 'italic';
    taContainer.appendChild(p);
    return;
  }

  const ul = document.createElement('ul');
  ul.style.listStyleType = 'none';
  ul.style.padding = '0';

  taClassesArray.forEach(taClass => {
    const li = document.createElement('li');
    li.style.border = '1px solid #e0e0e0';
    li.style.backgroundColor = '#fff';
    li.style.padding = '10px';
    li.style.marginBottom = '8px';
    li.style.borderRadius = '4px';

    // Content Div for TA class details
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = `
      <strong style="color: #007bff;">${taClass.subject || 'N/A Subject'} (TA)</strong><br>
      Day: ${taClass.day || 'N/A Day'}, Time: ${taClass.time || 'N/A Time'}<br>
      Room: ${taClass.room || 'N/A'}
    `;
    li.appendChild(contentDiv);

    // Controls Div for buttons
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'ta-item-controls'; // For styling

    const editButton = document.createElement('button');
    editButton.className = 'ta-edit-btn';
    editButton.textContent = 'Edit';
    editButton.dataset.id = taClass.id;

    const deleteButton = document.createElement('button');
    deleteButton.className = 'ta-delete-btn';
    deleteButton.textContent = 'Delete';
    deleteButton.dataset.id = taClass.id;

    controlsDiv.appendChild(editButton);
    controlsDiv.appendChild(deleteButton);
    li.appendChild(controlsDiv);

    li.dataset.taClassId = taClass.id;
    ul.appendChild(li);
  });
  taContainer.appendChild(ul);
  console.log("Content Script: Rendered TA classes on page.", taClassesArray);
}

function injectAddTaButtonAndForm() {
  // --- Create "Add TA Class" Button ---
  const addButton = document.createElement('button');
  addButton.id = 'inpage-add-ta-button';
  addButton.textContent = 'Add New TA Class';
  // Basic styling, will be refined in page_theme.css
  addButton.style.position = 'fixed';
  addButton.style.bottom = '20px';
  addButton.style.right = '20px';
  addButton.style.padding = '10px 15px';
  addButton.style.zIndex = '10000'; // Ensure it's on top

  // --- Create "Add TA Class" Form (initially hidden) ---
  const formContainer = document.createElement('div');
  formContainer.id = 'inpage-ta-form-container';
  formContainer.style.display = 'none'; // Hidden by default
  formContainer.style.position = 'fixed';
  formContainer.style.top = '50%';
  formContainer.style.left = '50%';
  formContainer.style.transform = 'translate(-50%, -50%)';
  formContainer.style.padding = '20px';
  formContainer.style.border = '1px solid #ccc';
  formContainer.style.backgroundColor = 'white';
  formContainer.style.zIndex = '10001';
  formContainer.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';

  formContainer.innerHTML = `
    <h3>Add / Edit TA Class (In-Page)</h3>
    <div>
      <label for="inpage-ta-subject">Subject:</label>
      <input type="text" id="inpage-ta-subject" name="subject" required>
    </div>
    <div>
      <label for="inpage-ta-day">Day:</label>
      <select id="inpage-ta-day" name="day">
        <option value="Mon">Monday</option>
        <option value="Tue">Tuesday</option>
        <option value="Wed">Wednesday</option>
        <option value="Thu">Thursday</option>
        <option value="Fri">Friday</option>
        <option value="Sat">Saturday</option>
        <option value="Sun">Sunday</option>
      </select>
    </div>
    <div>
      <label for="inpage-ta-time">Time (e.g., HH:MM-HH:MM):</label>
      <input type="text" id="inpage-ta-time" name="time" required placeholder="09:00-12:00">
    </div>
    <div>
      <label for="inpage-ta-room">Room:</label>
      <input type="text" id="inpage-ta-room" name="room">
    </div>
    <button type="button" id="inpage-ta-save-button">Save TA Class</button>
    <button type="button" id="inpage-ta-cancel-button" style="margin-left: 10px;">Cancel</button>
  `;

  // Append button and form to the body
  document.body.appendChild(addButton);
  document.body.appendChild(formContainer);

  // --- Event Listener for Add Button ---
  addButton.addEventListener('click', () => {
    currentEditingTaId = null; // Ensure we are in "add" mode
    const formContainer = document.getElementById('inpage-ta-form-container');
    if (formContainer) {
        formContainer.style.display = 'block';
        document.getElementById('inpage-ta-subject').value = '';
        document.getElementById('inpage-ta-day').value = 'Mon'; // Default
        document.getElementById('inpage-ta-time').value = '';
        document.getElementById('inpage-ta-room').value = '';
        formContainer.querySelector('h3').textContent = 'Add New TA Class'; // Title for Add
        formContainer.querySelector('#inpage-ta-save-button').textContent = 'Save TA Class'; // Button text for Add
    }
  });

  // --- Event Listener for Cancel Button on Form ---
  const cancelButton = formContainer.querySelector('#inpage-ta-cancel-button');
  cancelButton.addEventListener('click', () => {
    formContainer.style.display = 'none';
  });

  // --- Event Listener for Save Button on Form ---
  const saveButton = formContainer.querySelector('#inpage-ta-save-button');
  saveButton.addEventListener('click', async () => {
    const subject = document.getElementById('inpage-ta-subject').value.trim();
    const day = document.getElementById('inpage-ta-day').value;
    const time = document.getElementById('inpage-ta-time').value.trim();
    const room = document.getElementById('inpage-ta-room').value.trim();

    if (!subject || !day || !time) {
      alert("Please fill in Subject, Day, and Time for the TA class.");
      return;
    }

    // Basic time format validation (example: HH:MM-HH:MM)
    if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(time)) {
      alert("Invalid time format. Please use HH:MM-HH:MM (e.g., 09:00-12:00).");
      return;
    }

    try {
      let currentTaClasses = await fetchTaClassesFromStorage();

      if (currentEditingTaId) {
        // ---- EDIT MODE ----
        const itemIndex = currentTaClasses.findIndex(ta => ta.id === currentEditingTaId);
        if (itemIndex > -1) {
          currentTaClasses[itemIndex] = {
            ...currentTaClasses[itemIndex], // Preserve other potential properties
            id: currentEditingTaId, // Ensure ID is maintained
            subject: subject,
            day: day,
            time: time,
            room: room,
            type: 'TA' // Ensure type is maintained
          };
          await saveTaClassesToStorage(currentTaClasses);
          renderTaClassesOnPage(currentTaClasses); // Re-render all TA classes
          alert("TA Class updated successfully!");
          console.log("Content Script: TA class updated and saved.", currentTaClasses[itemIndex]);
        } else {
          alert("Error: TA class to update not found. It might have been deleted.");
          console.error("Content Script: TA class to update not found for ID:", currentEditingTaId);
        }
        currentEditingTaId = null; // Reset editing ID
      } else {
        // ---- ADD MODE ----
        const newTaClass = {
          id: generateTrulyUniqueIdentifier(),
          subject: subject,
          day: day,
          time: time,
          room: room,
          type: 'TA'
        };
        currentTaClasses.push(newTaClass);
        await saveTaClassesToStorage(currentTaClasses);
        renderTaClassesOnPage(currentTaClasses); // Re-render all TA classes
        alert("TA Class added successfully!");
        console.log("Content Script: New TA class added and saved.", newTaClass);
      }

      // Clear form, hide, and reset button texts (common for both modes)
      document.getElementById('inpage-ta-subject').value = '';
      document.getElementById('inpage-ta-day').value = 'Mon'; // Default
      document.getElementById('inpage-ta-time').value = '';
      document.getElementById('inpage-ta-room').value = '';
      document.getElementById('inpage-ta-form-container').style.display = 'none';
      // Reset form title and button text for the next "Add" operation is handled by the "Add New TA Class" button's click listener.

    } catch (error) {
      console.error("Content Script: Error saving TA class (add/edit):", error);
      alert("Failed to save TA class. See console for details.");
      if (currentEditingTaId) currentEditingTaId = null; // Reset on error too
    }
  });

  console.log("Content Script: Injected 'Add TA Class' button and form, with save logic.");
}

function setupTaItemActionListeners() {
  const taContainer = document.getElementById('custom-ta-classes-container');
  if (taContainer && !taContainer.dataset.listenersAttached) { // Check if listeners are already attached
    taContainer.addEventListener('click', async (event) => {
      if (event.target.classList.contains('ta-edit-btn')) {
        const taId = event.target.dataset.id;
        if (!taId) return;

        currentEditingTaId = taId; // Set the ID of the item being edited

        try {
          const taClasses = await fetchTaClassesFromStorage();
          const taToEdit = taClasses.find(ta => ta.id === taId);

          if (taToEdit) {
            // Populate the form
            document.getElementById('inpage-ta-subject').value = taToEdit.subject;
            document.getElementById('inpage-ta-day').value = taToEdit.day;
            document.getElementById('inpage-ta-time').value = taToEdit.time;
            document.getElementById('inpage-ta-room').value = taToEdit.room || '';

            // Change form title and save button text
            const formContainer = document.getElementById('inpage-ta-form-container');
            if (formContainer) {
              formContainer.querySelector('h3').textContent = 'Edit TA Class';
              formContainer.querySelector('#inpage-ta-save-button').textContent = 'Update TA Class';
              formContainer.style.display = 'block';
            }
          } else {
            console.error("Content Script: TA class to edit not found in storage.", taId);
            currentEditingTaId = null; // Reset if not found
            alert("Error: Could not find the TA class to edit.");
          }
        } catch (error) {
          console.error("Content Script: Error preparing edit for TA class:", error);
          currentEditingTaId = null;
          alert("Error preparing edit. See console.");
        }
      }
      else if (event.target.classList.contains('ta-delete-btn')) {
        const taId = event.target.dataset.id;
        if (!taId) return;

        if (window.confirm("Are you sure you want to delete this TA class?")) {
          try {
            let currentTaClasses = await fetchTaClassesFromStorage();
            const initialLength = currentTaClasses.length;
            currentTaClasses = currentTaClasses.filter(ta => ta.id !== taId);

            if (currentTaClasses.length < initialLength) { // Item was actually found and filtered
              await saveTaClassesToStorage(currentTaClasses);

              // Remove the item directly from the DOM for immediate feedback
              const itemElementToRemove = event.target.closest('li'); // Assuming TA items are <li>
              if (itemElementToRemove) {
                itemElementToRemove.remove();
              } else {
                // Fallback to re-rendering if direct removal is problematic
                renderTaClassesOnPage(currentTaClasses);
              }

              alert("TA Class deleted successfully!");
              console.log("Content Script: TA class deleted.", taId);

              // If the list becomes empty after deletion, update the container message
              if (currentTaClasses.length === 0) {
                  const container = document.getElementById('custom-ta-classes-container');
                  if (container && container.querySelector('ul')) { // Check if ul exists
                      const ulElement = container.querySelector('ul');
                      if (ulElement.children.length === 0) { // Check if DOM reflects empty after removal
                           // If renderTaClassesOnPage was called, it handles the empty message.
                           // If not (direct DOM removal), we might need to explicitly call it or set empty message.
                           renderTaClassesOnPage([]); // Call to show "No TA classes" message
                      }
                  } else if (container) { // No ul, means renderTaClassesOnPage already set empty message
                      renderTaClassesOnPage([]);
                  }
              }

            } else {
              alert("Error: TA class to delete not found. It might have already been deleted.");
              console.error("Content Script: TA class to delete not found for ID:", taId);
            }
          } catch (error) {
            console.error("Content Script: Error deleting TA class:", error);
            alert("Failed to delete TA class. See console for details.");
          }
        }
      }
    });
    taContainer.dataset.listenersAttached = 'true'; // Mark listeners as attached
    console.log("Content Script: TA item action listeners set up on #custom-ta-classes-container.");
  }
}

function injectThemeToggleButton(initialStateIsThemed) {
  if (document.getElementById('kmitl-theme-toggle-button')) return; // Already injected

  const toggleButton = document.createElement('button');
  toggleButton.id = 'kmitl-theme-toggle-button';
  // Text will be set based on current theme state
  toggleButton.style.position = 'fixed';
  toggleButton.style.bottom = '70px'; // Position above Add TA button or adjust
  toggleButton.style.right = '20px';  // (Adjust if Add TA button is also bottom-right)
  toggleButton.style.zIndex = '10000';
  // Basic styling, to be enhanced by page_theme.css

  function updateButtonText(isThemed) {
    toggleButton.textContent = isThemed ? 'View Original Design' : 'View KMITL+ Theme';
  }

  updateButtonText(initialStateIsThemed); // Set initial text

  toggleButton.addEventListener('click', async () => {
    const isCurrentlyThemed = !document.body.classList.contains(THEME_DISABLED_BODY_CLASS);
    const newThemedState = !isCurrentlyThemed;

    if (newThemedState) {
      document.body.classList.remove(THEME_DISABLED_BODY_CLASS);
    } else {
      document.body.classList.add(THEME_DISABLED_BODY_CLASS);
    }
    updateButtonText(newThemedState);

    try {
      await chrome.storage.local.set({ [THEME_ENABLED_STORAGE_KEY]: newThemedState });
      console.log('Content Script: Theme state saved:', newThemedState);
    } catch (error) {
      console.error('Content Script: Error saving theme state:', error);
    }
  });
  document.body.appendChild(toggleButton);
  console.log('Content Script: Theme toggle button injected.');
}


async function initializeExtensionFeatures() {
  console.log("Content Script: Initializing KMITL Schedule Enhancer features on page load.");

  // --- Theme Initialization ---
  let themeEnabled = true; // Default to theme being ON
  try {
    const result = await chrome.storage.local.get([THEME_ENABLED_STORAGE_KEY]);
    if (result[THEME_ENABLED_STORAGE_KEY] !== undefined) {
      themeEnabled = result[THEME_ENABLED_STORAGE_KEY];
    }
    console.log('Content Script: Loaded theme state:', themeEnabled);
  } catch (error) {
    console.error('Content Script: Error loading theme state:', error);
    // Proceed with default themeEnabled = true
  }

  if (!themeEnabled) { // If theme is stored as disabled
    document.body.classList.add(THEME_DISABLED_BODY_CLASS);
  } else {
    document.body.classList.remove(THEME_DISABLED_BODY_CLASS); // Ensure enabled if no class or stored as true
  }
  // --- End Theme Initialization ---

  try {
    const taClasses = await fetchTaClassesFromStorage();
    renderTaClassesOnPage(taClasses); // This might create #custom-ta-classes-container

    // Ensure UI elements are injected only once
    if (!document.getElementById('inpage-add-ta-button')) {
        injectAddTaButtonAndForm(); // This creates the form and its buttons
    }
    if (!document.getElementById('kmitl-theme-toggle-button')) {
        injectThemeToggleButton(themeEnabled); // Pass initial state
    }

    // Setup listeners after TA classes and form are potentially on the page
    // Check if listener setup function has already run to prevent multiple attachments
    if (!document.getElementById('custom-ta-classes-container')?.dataset.listenersAttached) {
        setupTaItemActionListeners(); // Contains edit/delete listeners for TA items
        if(document.getElementById('custom-ta-classes-container')) {
            document.getElementById('custom-ta-classes-container').dataset.listenersAttached = 'true';
        }
    }
  } catch (error) {
    console.error("Content Script: Error during initial feature setup:", error);
  }
}

// Ensure this runs after the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeExtensionFeatures);
} else {
  initializeExtensionFeatures(); // DOM is already ready
}
