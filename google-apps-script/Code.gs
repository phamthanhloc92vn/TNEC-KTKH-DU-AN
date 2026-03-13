/**
 * Google Apps Script - Đồng bộ dữ liệu Hợp Đồng từ ContractPilot
 * Version 2.0 - Fix section routing
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheetName = data.sheetName || "Tổng Hợp";
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, 10).setValues([[
        "STT", "Tên dự án/gói thầu", "Số hợp đồng", "Đơn vị ký HĐ",
        "Hợp đồng", "Tỷ lệ HĐ", "Đã tạm ứng", "Thu hồi tạm ứng",
        "Còn lại chưa thu hồi", "Tên file HĐ"
      ]]);
    }
    
    var soHopDong = data.soHopDong || "N/A";
    
    if (sheetName === "Tổng Hợp") {
      return handleTongHop(sheet, data, soHopDong);
    } else {
      return handleProjectSheet(sheet, data, soHopDong);
    }
    
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleProjectSheet(sheet, data, soHopDong) {
  var lastRow = sheet.getLastRow();
  var existingRow = -1;
  
  if (lastRow > 1) {
    var existingData = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
    for (var i = 0; i < existingData.length; i++) {
      if (String(existingData[i][0]).trim() === soHopDong) {
        existingRow = i + 2;
        break;
      }
    }
  }
  
  var rowData = [
    data.stt || "",
    data.tenDuAn || "",
    data.soHopDong || "",
    data.donViKy || "",
    data.giaTri || "",
    data.tiLeHopDong || "",
    data.daTamUng || "",
    data.thuHoiTamUng || "",
    data.conLaiChuaThuHoi || "",
    data.tenFileHD || ""
  ];
  
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, 10).setValues([rowData]);
    return respond("success", { action: "updated", sheet: data.sheetName, hopDong: soHopDong, row: existingRow });
  } else {
    sheet.appendRow(rowData);
    return respond("success", { action: "inserted", sheet: data.sheetName, hopDong: soHopDong });
  }
}

/**
 * Xử lý sheet "Tổng Hợp" - Phiên bản 2 (fix section detection)
 * 
 * Logic tìm section: Quét TOÀN BỘ cột A+B, tìm bất kỳ ô nào chứa:
 * - "Chủ đầu tư" hoặc bắt đầu bằng "I" (Mục I)
 * - "Nhà thầu phụ" hoặc bắt đầu bằng "II" (Mục II)
 */
function handleTongHop(sheet, data, soHopDong) {
  var loaiHopDong = data.loaiHopDong || "CHU_DAU_TU";
  var lastRow = Math.max(sheet.getLastRow(), 1);
  
  // ═══ TÌM VỊ TRÍ MỤC I VÀ MỤC II ═══
  var sectionIRow = -1;
  var sectionIIRow = -1;
  
  // Đọc cột A đến F (merge cells có thể nằm ở nhiều cột)
  var numCols = Math.min(sheet.getLastColumn(), 6);
  if (numCols < 1) numCols = 2;
  var allData = sheet.getRange(1, 1, lastRow, numCols).getValues();
  
  for (var i = 0; i < allData.length; i++) {
    // Ghép tất cả cell trong dòng thành 1 chuỗi để tìm
    var rowText = "";
    for (var c = 0; c < allData[i].length; c++) {
      rowText += " " + String(allData[i][c]).trim();
    }
    rowText = rowText.toLowerCase().trim();
    
    // Tìm Mục I: chứa "chủ đầu tư" hoặc cell A = "i" (không phải "ii")
    if (rowText.indexOf("chủ đầu tư") >= 0 || rowText.indexOf("chu dau tu") >= 0) {
      sectionIRow = i + 1;
    } else {
      var cellA = String(allData[i][0]).trim().toUpperCase();
      if (cellA === "I" && sectionIRow === -1) {
        sectionIRow = i + 1;
      }
    }
    
    // Tìm Mục II: chứa "nhà thầu phụ" hoặc cell A = "ii"
    if (rowText.indexOf("nhà thầu phụ") >= 0 || rowText.indexOf("nha thau phu") >= 0) {
      sectionIIRow = i + 1;
    } else {
      var cellA2 = String(allData[i][0]).trim().toUpperCase();
      if (cellA2 === "II" && sectionIIRow === -1) {
        sectionIIRow = i + 1;
      }
    }
  }
  
  // Log kết quả tìm kiếm
  Logger.log("Section I row: " + sectionIRow + ", Section II row: " + sectionIIRow);
  Logger.log("loaiHopDong: " + loaiHopDong + ", soHopDong: " + soHopDong);
  
  // Nếu không tìm thấy, tạo mới
  if (sectionIRow === -1) {
    sectionIRow = lastRow + 2;
    sheet.getRange(sectionIRow, 1).setValue("I");
    sheet.getRange(sectionIRow, 2).setValue("Chủ đầu tư (A-B)");
    lastRow = sectionIRow;
  }
  if (sectionIIRow === -1) {
    sectionIIRow = lastRow + 2;
    sheet.getRange(sectionIIRow, 1).setValue("II");
    sheet.getRange(sectionIIRow, 2).setValue("Nhà thầu phụ (B-B')");
    lastRow = sectionIIRow;
  }
  
  // ═══ XÁC ĐỊNH VÙNG CHÈN ═══
  var rowData = [
    "", // STT
    data.tenDuAn || "",
    data.soHopDong || "",
    data.donViKy || "",
    data.giaTri || "",
    data.tiLeHopDong || "",
    data.daTamUng || "",
    data.thuHoiTamUng || "",
    data.conLaiChuaThuHoi || "",
    data.tenFileHD || ""
  ];
  
  var searchStartRow, searchEndRow;
  var sectionLabel;
  
  if (loaiHopDong === "NHA_THAU_PHU") {
    searchStartRow = sectionIIRow + 1;
    searchEndRow = sheet.getLastRow();
    sectionLabel = "II - Nhà thầu phụ";
  } else {
    // CHU_DAU_TU (mặc định)
    searchStartRow = sectionIRow + 1;
    searchEndRow = sectionIIRow - 1;
    sectionLabel = "I - Chủ đầu tư";
  }
  
  // ═══ KIỂM TRA TRÙNG SỐ HĐ ═══
  var existingRow = -1;
  if (searchEndRow >= searchStartRow && searchStartRow > 0) {
    var numRows = searchEndRow - searchStartRow + 1;
    if (numRows > 0) {
      var searchRange = sheet.getRange(searchStartRow, 3, numRows, 1).getValues();
      for (var j = 0; j < searchRange.length; j++) {
        if (String(searchRange[j][0]).trim() === soHopDong) {
          existingRow = searchStartRow + j;
          break;
        }
      }
    }
  }
  
  Logger.log("existingRow: " + existingRow + ", searchStart: " + searchStartRow + ", searchEnd: " + searchEndRow);
  
  // ═══ GHI DỮ LIỆU ═══
  var action = "";
  var targetRow = -1;
  
  if (existingRow > 0) {
    // Update dòng cũ
    sheet.getRange(existingRow, 1, 1, 10).setValues([rowData]);
    action = "updated";
    targetRow = existingRow;
  } else {
    // Tìm DÒNG TRỐNG ĐẦU TIÊN trong vùng section
    var emptyRow = -1;
    if (searchEndRow >= searchStartRow && searchStartRow > 0) {
      var numRows = searchEndRow - searchStartRow + 1;
      if (numRows > 0) {
        var checkRange = sheet.getRange(searchStartRow, 3, numRows, 1).getValues();
        for (var k = 0; k < checkRange.length; k++) {
          if (String(checkRange[k][0]).trim() === "") {
            emptyRow = searchStartRow + k;
            break;
          }
        }
      }
    }
    
    if (emptyRow > 0) {
      // Ghi vào dòng trống có sẵn (không insert dòng mới)
      sheet.getRange(emptyRow, 1, 1, 10).setValues([rowData]);
      action = "inserted";
      targetRow = emptyRow;
    } else if (loaiHopDong === "NHA_THAU_PHU") {
      // Hết chỗ trống → thêm cuối sheet
      var insertAt = sheet.getLastRow() + 1;
      sheet.getRange(insertAt, 1, 1, 10).setValues([rowData]);
      action = "inserted";
      targetRow = insertAt;
    } else {
      // CHU_DAU_TU hết chỗ trống → chèn trước mục II
      var currentIIRow = findSectionRow(sheet, sheet.getLastRow(), "II");
      if (currentIIRow === -1) currentIIRow = sectionIIRow;
      sheet.insertRowBefore(currentIIRow);
      sheet.getRange(currentIIRow, 1, 1, 10).setValues([rowData]);
      action = "inserted";
      targetRow = currentIIRow;
    }
  }
  
  // Đánh lại STT
  reNumberSTT(sheet);
  
  return respond("success", { 
    action: action, 
    sheet: "Tổng Hợp", 
    section: sectionLabel,
    loaiHopDong: loaiHopDong,
    hopDong: soHopDong, 
    row: targetRow,
    sectionIRow: sectionIRow,
    sectionIIRow: sectionIIRow
  });
}

/**
 * Tìm dòng chứa section header ("I" hoặc "II") trong cột A
 */
function findSectionRow(sheet, lastRow, sectionId) {
  if (lastRow < 1) return -1;
  var colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (var i = 0; i < colA.length; i++) {
    if (String(colA[i][0]).trim().toUpperCase() === sectionId) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Đánh lại STT cho sheet Tổng Hợp
 */
function reNumberSTT(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  
  var colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  var colC = sheet.getRange(1, 3, lastRow, 1).getValues();
  
  var sttCounter = 0;
  var inSection = false;
  
  for (var i = 0; i < colA.length; i++) {
    var cellA = String(colA[i][0]).trim().toUpperCase();
    
    if (cellA === "I" || cellA === "II") {
      sttCounter = 0;
      inSection = true;
      continue;
    }
    
    if (inSection && String(colC[i][0]).trim() !== "" && String(colC[i][0]).trim() !== "N/A") {
      sttCounter++;
      sheet.getRange(i + 1, 1).setValue(sttCounter);
    }
  }
}

function respond(status, extra) {
  var result = { status: status };
  for (var key in extra) {
    result[key] = extra[key];
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function testDoPost() {
  var testPayload = {
    postData: {
      contents: JSON.stringify({
        sheetName: "Tổng Hợp",
        tenDuAn: "Test - Gói thầu Thường Phước",
        soHopDong: "HD_TEST_001",
        donViKy: "Ban Quản lý Khu Kinh tế tỉnh Đồng Tháp",
        giaTri: "95.092.891.627 VND",
        tiLeHopDong: "87%",
        daTamUng: "28.528.914.720 VND",
        thuHoiTamUng: "N/A",
        conLaiChuaThuHoi: "N/A",
        loaiHopDong: "CHU_DAU_TU",
        tenFileHD: "test.pdf"
      })
    }
  };
  
  var result = doPost(testPayload);
  Logger.log(result.getContent());
}

// ═══════════════════════════════════════════════════════════════
// AUTO-SYNC: Khi sửa cột K-U trên sheet dự án → cập nhật Tổng Hợp
// ═══════════════════════════════════════════════════════════════

/**
 * Trigger tự động khi chỉnh sửa ô trên bất kỳ sheet nào (trừ Tổng Hợp)
 * 
 * Cách hoạt động:
 * 1. Phát hiện sửa ô trên sheet dự án (VD: "Xử lý nước thải tây ninh")
 * 2. Lấy Số HĐ (cột C) của dòng vừa sửa
 * 3. Tìm dòng có cùng Số HĐ trên sheet "Tổng Hợp"
 * 4. Copy toàn bộ giá trị cột K-U từ sheet dự án → Tổng Hợp
 * 
 * HƯỚNG DẪN CÀI ĐẶT:
 * 1. Trong Apps Script Editor → menu "Triggers" (biểu tượng đồng hồ bên trái)
 * 2. "Add Trigger" → chọn function: onEditSync
 * 3. Event source: From spreadsheet
 * 4. Event type: On edit
 * 5. Save
 */
function onEditSync(e) {
  try {
    var sheet = e.source.getActiveSheet();
    var sheetName = sheet.getName();
    
    // Bỏ qua nếu đang sửa trên sheet Tổng Hợp
    if (sheetName === "Tổng Hợp") return;
    
    var range = e.range;
    var row = range.getRow();
    var col = range.getColumn();
    
    // Bỏ qua nếu sửa dòng header (dòng 1-2)
    if (row <= 2) return;
    
    // Lấy Số HĐ từ cột C (cột 3) của dòng vừa sửa
    var soHopDong = String(sheet.getRange(row, 3).getValue()).trim();
    if (!soHopDong || soHopDong === "" || soHopDong === "N/A") return;
    
    // Mở sheet Tổng Hợp
    var ss = e.source;
    var tongHopSheet = ss.getSheetByName("Tổng Hợp");
    if (!tongHopSheet) return;
    
    // Tìm dòng có cùng Số HĐ trong Tổng Hợp
    var tongHopLastRow = tongHopSheet.getLastRow();
    if (tongHopLastRow < 2) return;
    
    var tongHopCol3 = tongHopSheet.getRange(1, 3, tongHopLastRow, 1).getValues();
    var matchRow = -1;
    for (var i = 0; i < tongHopCol3.length; i++) {
      if (String(tongHopCol3[i][0]).trim() === soHopDong) {
        matchRow = i + 1;
        break;
      }
    }
    
    if (matchRow === -1) return; // Không tìm thấy Số HĐ trong Tổng Hợp
    
    // Copy cột K-U (cột 11-21) từ sheet dự án → Tổng Hợp
    var startCol = 11; // Cột K
    var endCol = 21;   // Cột U
    var numCols = endCol - startCol + 1;
    
    // Kiểm tra sheet dự án có đủ cột không
    var srcLastCol = sheet.getLastColumn();
    if (srcLastCol < startCol) return;
    
    var actualEndCol = Math.min(endCol, srcLastCol);
    var actualNumCols = actualEndCol - startCol + 1;
    
    // Lấy giá trị từ sheet dự án
    var srcValues = sheet.getRange(row, startCol, 1, actualNumCols).getValues();
    
    // Ghi vào Tổng Hợp
    tongHopSheet.getRange(matchRow, startCol, 1, actualNumCols).setValues(srcValues);
    
    Logger.log("✅ Auto-sync: sheet \"" + sheetName + "\" row " + row + 
               " → Tổng Hợp row " + matchRow + " (HĐ: " + soHopDong + 
               ", cột " + startCol + "-" + actualEndCol + ")");
    
  } catch (error) {
    Logger.log("❌ onEditSync error: " + error.toString());
  }
}
