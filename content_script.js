/**
 * Content script for KMITL Schedule Enhancer
 * Injected into pages matching the pattern in manifest.json.
 * Responsibilities:
 * 1. Extract schedule data from the KMITL schedule page.
 * 2. Send this data to the popup when requested.
 */

console.log("KMITL Schedule Enhancer: Content script injected and attempting to run.");

/**
 * Extracts schedule data from the KMITL schedule page.
 * This is a PLACEHOLDER function. It needs to be adapted to the actual
 * structure of the KMITL schedule page.
 *
 * @returns {Array<Object>} An array of schedule item objects.
 *          Each object should have: { day: String, time: String, subject: String, room: String, type: 'regular' }
 *          Returns an empty array if no data is found or if an error occurs.
 */
function extractScheduleDataFromPage() {
  console.log("Content Script: extractScheduleDataFromPage() called.");

  // ** --- Placeholder Scraping Logic --- **
  // The following is an EXAMPLE of how you might approach scraping.
  // You will need to inspect the actual KMITL schedule page to determine the correct selectors.

  const scheduleItems = [];

  // Example: If schedule data is in a table with id="scheduleTable"
  // const scheduleTable = document.getElementById('scheduleTable');
  // if (scheduleTable) {
  //   const rows = scheduleTable.querySelectorAll('tbody tr'); // Get all rows in the table body
  //   rows.forEach(row => {
  //     try {
  //       // Assuming columns are in order: Day, Time, Subject, Room
  //       const cells = row.querySelectorAll('td');
  //       if (cells.length >= 4) {
  //         const day = cells[0].innerText.trim();
  //         const time = cells[1].innerText.trim();
  //         const subject = cells[2].innerText.trim();
  //         const room = cells[3].innerText.trim();

  //         if (subject && time) { // Basic validation
  //           scheduleItems.push({
  //             day: day,
  //             time: time,
  //             subject: subject,
  //             room: room,
  //             type: 'regular' // Mark as a regular schedule item
  //           });
  //         }
  //       }
  //     } catch (e) {
  //       console.error("Content Script: Error parsing a row:", e, row);
  //     }
  //   });
  // } else {
  //   console.warn("Content Script: Could not find the expected schedule table (e.g., #scheduleTable).");
  // }

  // Example: If schedule data is in a list of divs, each with class "course-entry"
  // const courseEntries = document.querySelectorAll('.course-entry');
  // courseEntries.forEach(entry => {
  //   try {
  //     const subject = entry.querySelector('.course-subject')?.innerText.trim();
  //     const time = entry.querySelector('.course-time')?.innerText.trim();
  //     const day = entry.querySelector('.course-day')?.innerText.trim();
  //     const room = entry.querySelector('.course-room')?.innerText.trim();
  //     if (subject && time && day) {
  //       scheduleItems.push({ day, time, subject, room, type: 'regular' });
  //     }
  //   } catch(e) {
  //     console.error("Content Script: Error parsing a course entry:", e, entry);
  //   }
  // });
  // if (courseEntries.length === 0) {
  //    console.warn("Content Script: Could not find any elements matching '.course-entry'.");
  // }


  // ** --- End of Placeholder Scraping Logic --- **

  // If no items were scraped, return the mock data for testing purposes.
  // REMOVE THIS MOCK DATA WHEN IMPLEMENTING ACTUAL SCRAPING.
  if (scheduleItems.length === 0) {
    console.warn("Content Script: No actual data scraped. Returning MOCK data for testing.");
    const mockDataFromContentScript = [
      { day: "Mon", time: "09:00-12:00", subject: "Mock Eng. Math (CS)", room: "ECC-701 (CS)", type: 'regular' },
      { day: "Wed", time: "13:00-16:00", subject: "Mock Thermo. (CS)", room: "CHE-203 (CS)", type: 'regular' },
      { day: "Fri", time: "10:00-11:00", subject: "Mock Ethics (CS)", room: "GEN-101 (CS)", type: 'regular' }
    ];
    return mockDataFromContentScript;
  }

  console.log(`Content Script: Extracted ${scheduleItems.length} items from page.`);
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
