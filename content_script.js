/**
 * Content script for KMITL Schedule Enhancer
 * Injected into pages matching the pattern in manifest.json.
 * Responsibilities:
 * 1. Extract schedule data from the KMITL schedule page.
 * 2. Send this data to the popup when requested.
 */

console.log("KMITL Schedule Enhancer: Content script injected and attempting to run.");

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

  // Select the second table with width="1258" as it's more likely the main schedule table.
  const tables = document.querySelectorAll('table[width="1258"]');
  const scheduleTable = tables.length > 1 ? tables[1] : null;

  if (!scheduleTable) {
    console.warn("Content Script: Could not find the main schedule table (expected second table with width='1258').");
    // Attempt to find a table with 'รหัสวิชา' header as a fallback
    const allTables = document.querySelectorAll('table');
    for (let table of allTables) {
        if (table.innerText.includes('รหัสวิชา') && table.innerText.includes('ชื่อวิชา')) {
            console.log("Content Script: Found table by header content as a fallback.");
            scheduleTable = table;
            break;
        }
    }
    if (!scheduleTable) {
        console.error("Content Script: Still could not find the schedule table using fallback method.");
        return [];
    }
  }

  const rows = scheduleTable.querySelectorAll('tbody tr');
  console.log(`Content Script: Found ${rows.length} rows in the schedule table.`);

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
    let courseCodeCellIndex = 1;
    let courseNameCellIndex = 2;
    let dayTimeCellIndex = 6;
    let roomCellIndex = 7;

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
