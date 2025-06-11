/**
 * Popup script for KMITL Schedule Enhancer
 * Handles UI, user interactions, data fetching from content script,
 * TA class management, data persistence, and export functionalities.
 */
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const scheduleList = document.getElementById('schedule-list');
  const scheduleContainer = document.getElementById('schedule-container');
  const loadingMessage = document.getElementById('loading-message');
  const noScheduleMessage = document.getElementById('no-schedule-message');
  const refreshButton = document.getElementById('refresh-button');
  const addTaClassForm = document.getElementById('add-ta-class-form');
  const addTaButton = document.getElementById('add-ta-button');
  const exportImageButton = document.getElementById('export-image-button');
  const exportPdfButton = document.getElementById('export-pdf-button');
  const exportFeedback = document.getElementById('export-feedback');

  let currentScheduleData = [];
  let editingTaClassId = null;

  // --- Utility Functions (Copied/Ensured from previous steps) ---
  const generateTrulyUniqueIdentifier = () => `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const ensureItemId = (item) => {
    if (item.type === 'TA') {
      if (!item.id) item.id = generateTrulyUniqueIdentifier();
    } else if (!item.id) {
      item.id = `item-${item.day}-${item.time}-${item.subject}`.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase();
    }
    return item.id;
  };
  const reorderData = (data, orderedIds) => {
    const dataMap = new Map(data.map(item => [item.id, item]));
    let orderedData = orderedIds.map(id => dataMap.get(id)).filter(item => item);
    const presentIds = new Set(orderedIds);
    data.forEach(item => { if (!presentIds.has(item.id)) orderedData.push(item); });
    return orderedData;
  };
  const getDragAfterElement = (container, y) => {
    const draggableElements = [...container.querySelectorAll('.schedule-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  };

  /**
   * Displays a feedback message for export operations.
   * @param {string} message - The message to display.
   * @param {boolean} isError - True if the message is an error, false otherwise.
   */
  function showExportFeedback(message, isError = false) {
    exportFeedback.textContent = message;
    exportFeedback.className = 'feedback-message'; // Reset classes
    if (isError) {
      exportFeedback.classList.add('error');
    }
    exportFeedback.style.display = 'block';
    setTimeout(() => {
      exportFeedback.style.display = 'none';
    }, isError ? 5000 : 3000); // Show errors for a bit longer
  }

  // --- Display and Data Loading Functions (Copied/Ensured) ---
  const displaySchedule = (scheduleData) => {
    // console.log("Popup: displaySchedule called with data:", scheduleData); // Less verbose for final
    scheduleList.innerHTML = '';
    loadingMessage.style.display = 'none';
    if (!scheduleData || scheduleData.length === 0) {
      noScheduleMessage.textContent = "No schedule data. Add TA classes or refresh from a KMITL schedule page.";
      noScheduleMessage.style.display = 'block'; scheduleList.style.display = 'none'; return;
    }
    noScheduleMessage.style.display = 'none'; scheduleList.style.display = 'block';
    scheduleData.forEach((item, index) => {
      ensureItemId(item);
      const listItem = document.createElement('li'); listItem.classList.add('schedule-item');
      listItem.setAttribute('draggable', 'true'); listItem.id = item.id; listItem.dataset.index = index;
      const controlsContainer = document.createElement('div'); controlsContainer.classList.add('item-controls');
      if (item.type === 'TA') {
        listItem.classList.add('ta-class-item');
        const taLabel = document.createElement('span'); taLabel.classList.add('ta-label'); taLabel.textContent = 'TA'; listItem.appendChild(taLabel);
        const editButton = document.createElement('button'); editButton.classList.add('edit-ta-button'); editButton.innerHTML = '&#9998;'; editButton.title = 'Edit TA Class'; editButton.dataset.id = item.id; controlsContainer.appendChild(editButton);
        const deleteButton = document.createElement('button'); deleteButton.classList.add('delete-ta-button'); deleteButton.innerHTML = '&#128465;'; deleteButton.title = 'Delete TA Class'; deleteButton.dataset.id = item.id; controlsContainer.appendChild(deleteButton);
      }
      const daySpan = document.createElement('span'); daySpan.classList.add('day'); daySpan.textContent = item.day || 'N/A';
      const timeSpan = document.createElement('span'); timeSpan.classList.add('time'); timeSpan.textContent = item.time || 'N/A';
      const subjectSpan = document.createElement('span'); subjectSpan.classList.add('subject'); subjectSpan.textContent = item.subject || 'No Subject';
      const roomSpan = document.createElement('span'); roomSpan.classList.add('room'); roomSpan.textContent = item.room || '';
      const contentDiv = document.createElement('div'); contentDiv.classList.add('item-content');
      contentDiv.appendChild(daySpan); contentDiv.appendChild(timeSpan); contentDiv.appendChild(subjectSpan); contentDiv.appendChild(roomSpan);
      listItem.appendChild(contentDiv); listItem.appendChild(controlsContainer); scheduleList.appendChild(listItem);
    });
    currentScheduleData = scheduleData;
  };
  const fetchScheduleDataFromContentScript = async () => {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) return reject(new Error("Tabs: " + chrome.runtime.lastError.message));
        if (!tabs || tabs.length === 0) return reject(new Error("No active tab."));
        const activeTab = tabs[0];
        if (!activeTab.id) return reject(new Error("Active tab unsuitable."));

        chrome.tabs.sendMessage(activeTab.id, { action: "getScheduleData" }, (response) => {
          if (chrome.runtime.lastError) return reject(new Error("Msg: " + chrome.runtime.lastError.message.split('.')[0])); // Split to get first part of message
          if (response && response.status === "success") resolve(response.data.map(item => ({ ...item, id: ensureItemId({...item, type: 'regular'}), type: 'regular' }))); // Ensure IDs for regular items
          else if (response && response.status === "error") reject(new Error("CS: " + response.message));
          else reject(new Error("No valid CS response."));
        });
      });
    });
  };
 const fetchTaClassesFromStorage = async () => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['taClasses'], (result) => {
        if (chrome.runtime.lastError) {
          console.error("Error fetching TA classes:", chrome.runtime.lastError.message);
          return reject(chrome.runtime.lastError);
        }
        // Ensure result.taClasses is an array, default to empty array if not found or not an array
        const taClasses = Array.isArray(result.taClasses) ? result.taClasses : [];
        resolve(taClasses);
      });
    });
  };

  // --- Simplified versions of copied async data functions for brevity in this final review block ---
  const saveScheduleOrder = async () => { /* Assume implemented as previously */
      const orderedIds = currentScheduleData.map(item => item.id);
      await chrome.storage.local.set({ scheduleOrder: orderedIds });
      if (chrome.runtime.lastError) console.error("Popup: Save order err:", chrome.runtime.lastError.message);
  };
  const loadScheduleAndTaData = async () => { /* Assume implemented as previously */
    loadingMessage.style.display = 'block'; noScheduleMessage.style.display = 'none';
    scheduleList.style.display = 'none'; scheduleList.innerHTML = ''; let regularSchedule = [], taClasses = [], fetchError = null;
    try { regularSchedule = await fetchScheduleDataFromContentScript(); } catch (e) { fetchError = e; }
    try { taClasses = await fetchTaClassesFromStorage(); } catch (e) { if (!fetchError) fetchError = e; }
    let combinedData = [...regularSchedule, ...taClasses];
    try {
      const orderResult = await chrome.storage.local.get('scheduleOrder'); if (chrome.runtime.lastError) throw new Error("Storage order get: " + chrome.runtime.lastError.message);
      if (orderResult.scheduleOrder && combinedData.length > 0) combinedData = reorderData(combinedData, orderResult.scheduleOrder);
      else if (combinedData.length > 0) { /* Default sort */ combinedData.sort((a,b)=>{const dO=["Mon","Tue","Wed","Thu","Fri","Sat","Sun","N/A"]; const dA=dO.indexOf(a.day||"N/A"); const dB=dO.indexOf(b.day||"N/A"); if(dA!==dB)return dA-dB; return(a.time||"").localeCompare(b.time||"");});}
    } catch (e) { if (!fetchError) fetchError = e; }
    currentScheduleData = combinedData; displaySchedule(currentScheduleData);
    if (currentScheduleData.length === 0 && fetchError) { noScheduleMessage.textContent = fetchError.message; noScheduleMessage.style.display = 'block'; scheduleList.style.display = 'none';}
    else if (currentScheduleData.length === 0) { noScheduleMessage.textContent = "No data. Add TAs or refresh KMITL page."; noScheduleMessage.style.display = 'block'; scheduleList.style.display = 'none';}
  };
  const handleAddOrUpdateTaClassSubmit = async (event) => { /* Assume implemented as previously */
    event.preventDefault(); const subject = document.getElementById('ta-subject').value.trim(); const day = document.getElementById('ta-day').value; const time = document.getElementById('ta-time').value.trim(); const room = document.getElementById('ta-room').value.trim();
    if (!subject || !day || !time) { alert("Fill Subject, Day, and Time."); return; }
    try {
      let taClasses = await fetchTaClassesFromStorage();
      if (!Array.isArray(taClasses)) { taClasses = []; } // Safety check
      if (editingTaClassId) { const cI=taClasses.findIndex(i=>i.id===editingTaClassId); if(cI>-1)taClasses[cI]={...taClasses[cI],subject,day,time,room}; const dI=currentScheduleData.findIndex(i=>i.id===editingTaClassId); if(dI>-1)currentScheduleData[dI]={...currentScheduleData[dI],subject,day,time,room}; editingTaClassId=null; addTaButton.textContent="Add TA Class"; }
      else { const nTC={subject,day,time,room,type:'TA',id:ensureItemId({type:'TA'})}; taClasses.push(nTC); currentScheduleData.push(nTC); }
      await chrome.storage.local.set({taClasses:taClasses}); if(chrome.runtime.lastError)throw new Error("Storage set TA: "+chrome.runtime.lastError.message);
      displaySchedule(currentScheduleData); await saveScheduleOrder(); addTaClassForm.reset();
    } catch(e){ alert("Failed to save TA: "+e.message); }
  };

  // --- Event Listeners (CRUD, D&D - Copied/Ensured) ---
  scheduleList.addEventListener('click', async (event) => { /* Assume implemented as previously */
    const target = event.target.closest('button'); if (!target) return; const id = target.dataset.id; if (!id) return;
    if (target.classList.contains('delete-ta-button')) {
      if (confirm("Delete this TA class?")) { try { currentScheduleData = currentScheduleData.filter(i=>i.id!==id); let tC=await fetchTaClassesFromStorage(); tC=tC.filter(i=>i.id!==id); await chrome.storage.local.set({taClasses:tC}); if(chrome.runtime.lastError)throw new Error("Storage del: "+chrome.runtime.lastError.message); displaySchedule(currentScheduleData); await saveScheduleOrder(); } catch(e){ alert("Failed to delete TA: "+e.message); }}
    } else if (target.classList.contains('edit-ta-button')) {
      const iTE=currentScheduleData.find(i=>i.id===id); if(iTE){document.getElementById('ta-subject').value=iTE.subject; document.getElementById('ta-day').value=iTE.day; document.getElementById('ta-time').value=iTE.time; document.getElementById('ta-room').value=iTE.room||''; editingTaClassId=id; addTaButton.textContent="Update TA Class"; document.getElementById('ta-subject').focus();}
    }
  });
  let draggedItem = null;
  scheduleList.addEventListener('dragstart', (e) => { if (e.target.classList.contains('schedule-item')) { draggedItem = e.target; e.dataTransfer.setData('text/plain', e.target.id); setTimeout(() => e.target.classList.add('dragging'), 0); } });
  scheduleList.addEventListener('dragover', (e) => e.preventDefault());
  scheduleList.addEventListener('drop', async (e) => { e.preventDefault(); if (!draggedItem) return; const dId=draggedItem.id; const fI=currentScheduleData.findIndex(i=>i.id===dId); if(fI===-1){draggedItem.classList.remove('dragging');draggedItem=null;return;} const iTM=currentScheduleData.splice(fI,1)[0]; const aE=getDragAfterElement(scheduleList,e.clientY); if(aE==null)currentScheduleData.push(iTM); else{const tI=currentScheduleData.findIndex(i=>i.id===aE.id); if(tI===-1)currentScheduleData.push(iTM); else currentScheduleData.splice(tI,0,iTM);} draggedItem.classList.remove('dragging'); displaySchedule(currentScheduleData); await saveScheduleOrder(); draggedItem=null; });
  scheduleList.addEventListener('dragend', (e) => { if (draggedItem && e.target.classList.contains('schedule-item')) e.target.classList.remove('dragging'); draggedItem = null; });


  // --- Export Functionality ---
  if (exportImageButton) {
    exportImageButton.addEventListener('click', async () => {
      if (typeof html2canvas === 'undefined') {
        showExportFeedback("Required library (html2canvas) not loaded. Please ensure it's correctly installed.", true);
        console.error("html2canvas is not defined.");
        return;
      }
      if(currentScheduleData.length === 0) {
        showExportFeedback("Cannot export an empty schedule.", true);
        return;
      }
      showExportFeedback("Generating image...", false);
      try {
        const canvas = await html2canvas(scheduleContainer, {
          backgroundColor: '#ffffff',
          logging: false, // Reduce console noise from html2canvas
          scale: window.devicePixelRatio > 1 ? window.devicePixelRatio : 2, // Improve resolution, cap at 2x or use devicePixelRatio
          useCORS: true,
          scrollY: 0 // Capture from top of element. If element itself scrolls, this might need adjustment.
        });
        const imageDataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = imageDataUrl;
        link.download = 'schedule.png';
        document.body.appendChild(link); // Required for Firefox
        link.click();
        document.body.removeChild(link);
        showExportFeedback("Image downloaded as schedule.png", false);
      } catch (error) {
        console.error("Image export error:", error);
        showExportFeedback("Error generating image. See console for details.", true);
      }
    });
  }

  if (exportPdfButton) {
    exportPdfButton.addEventListener('click', async () => {
      if (typeof html2canvas === 'undefined') {
        showExportFeedback("Required library (html2canvas) not loaded for PDF export.", true);
        console.error("html2canvas is not defined (needed for PDF export).");
        return;
      }
      if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        showExportFeedback("Required library (jsPDF) not loaded. Please ensure it's correctly installed.", true);
        console.error("jsPDF is not defined or jsPDF.jsPDF is not available.");
        return;
      }
      if(currentScheduleData.length === 0) {
        showExportFeedback("Cannot export an empty schedule.", true);
        return;
      }
      showExportFeedback("Generating PDF...", false);
      try {
        const canvas = await html2canvas(scheduleContainer, {
            backgroundColor: '#ffffff',
            scale: 2, // Higher scale for better PDF quality
            logging: false,
            scrollY: 0
        });
        const imageDataUrl = canvas.toDataURL('image/png');

        const { jsPDF } = window.jspdf;
        const pdfDoc = new jsPDF({
            orientation: 'p', // Start with portrait
            unit: 'mm',
            format: 'a4'
        });

        const pdfPageWidth = pdfDoc.internal.pageSize.getWidth() - 20; // 10mm margin each side
        const pdfPageHeight = pdfDoc.internal.pageSize.getHeight() - 20;

        const imgOriginalWidth = canvas.width;
        const imgOriginalHeight = canvas.height;
        const imgAspectRatio = imgOriginalWidth / imgOriginalHeight;

        let finalImgWidth, finalImgHeight;

        // Determine optimal orientation and dimensions
        if (imgAspectRatio > (pdfPageWidth / pdfPageHeight)) { // Image is wider than page aspect ratio (consider landscape)
            pdfDoc.internal.pageSize.setHeight(pdfDoc.internal.pageSize.getWidth()); // Make height = old width (A4 landscape width)
            pdfDoc.internal.pageSize.setWidth(pdfPageHeight + 20); // Make width = old height (A4 landscape height)

            const landscapePageWidth = pdfDoc.internal.pageSize.getWidth() - 20;
            // const landscapePageHeight = pdfDoc.internal.pageSize.getHeight() - 20; // Not used directly below

            finalImgWidth = landscapePageWidth;
            finalImgHeight = finalImgWidth / imgAspectRatio;
            // If still too tall for landscape, it will be multi-page (jsPDF handles this if configured)
            // or simply clipped if not. For single page, we might need to scale to height.
             if (finalImgHeight > (pdfDoc.internal.pageSize.getHeight() - 20)) {
                finalImgHeight = pdfDoc.internal.pageSize.getHeight() - 20;
                finalImgWidth = finalImgHeight * imgAspectRatio;
            }

        } else { // Image is taller or similar aspect ratio to page (use portrait)
            finalImgWidth = pdfPageWidth;
            finalImgHeight = finalImgWidth / imgAspectRatio;
             if (finalImgHeight > pdfPageHeight) { // If too tall for portrait
                finalImgHeight = pdfPageHeight;
                finalImgWidth = finalImgHeight * imgAspectRatio;
            }
        }

        // Add image, jsPDF auto-handles multi-page if image height > page height for many cases
        // However, for a single image, it's often better to scale it to fit one page if possible.
        // The logic above tries to fit it to one page, adjusting orientation.
        pdfDoc.addImage(imageDataUrl, 'PNG', 10, 10, finalImgWidth, finalImgHeight);
        pdfDoc.save('schedule.pdf');
        showExportFeedback("PDF downloaded as schedule.pdf", false);
      } catch (error) {
        console.error("PDF export error:", error);
        showExportFeedback("Error generating PDF. See console for details.", true);
      }
    });
  }

  // --- Final Setup ---
  if (addTaClassForm) addTaClassForm.addEventListener('submit', handleAddOrUpdateTaClassSubmit);
  if (refreshButton) refreshButton.addEventListener('click', loadScheduleAndTaData);
  loadScheduleAndTaData();
  console.log("Popup: Initialized with refined Export features.");
});
