var SPREADSHEET_ID = "1234567-w"; // Replace with your Sign-Out log spreadsheet ID
var INVENTORY_SPREADSHEET_ID = "12345678-ww"; // Replace with your Loaner Inventory Spreadsheet ID
var INVENTORY_SHEET_NAME = "Daily Loaners"; // Sheet name containing the list of valid Asset Tags
var EMAIL_RECIPIENTS = ["example1@example.com", "example2@example.com"]; // Replace with TC emails as needed

/**
 * Handles HTTP GET requests when the web app is accessed.
 * Loads the web app UI from "Index.html".
 * @returns {HtmlOutput} The rendered HTML page.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('MP Daily Loaner Sign In/ Sign Out');
}

/**
 * Retrieves the active Google Sheet for the current month.
 * If the sheet does not exist, it creates a new one with headers.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} The current month's sheet.
 */
function getMonthlySheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var date = new Date();
  var monthYear = date.toLocaleString("en-US", { month: "long", year: "numeric" }); // Example: "March 2025"
  var sheet = ss.getSheetByName(monthYear);

  if (!sheet) {
    Logger.log("Creating new sheet: " + monthYear);
    sheet = ss.insertSheet(monthYear);
    sheet.appendRow(["Name", "ID", "Asset Tag", "Sign Out Date & Time", "Sign In Date & Time"]); // Column headers
  }

  return sheet;
}

/**
 * Checks if an Asset Tag exists in the "Daily Loaners" inventory sheet.
 * @param {string} assetTag - The Asset Tag to check.
 * @returns {boolean} - Returns true if the Asset Tag is found, otherwise false.
 */
function isValidAssetTag(assetTag) {
  var inventorySheet = SpreadsheetApp.openById(INVENTORY_SPREADSHEET_ID).getSheetByName(INVENTORY_SHEET_NAME);
  if (!inventorySheet) {
    Logger.log("ERROR: Inventory sheet not found.");
    return false;
  }

  var data = inventorySheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { // Skip header row
    if (data[i][0] == assetTag) {
      return true; // Asset Tag exists in inventory
    }
  }

  return false;
}

/**
 * Validates that ID and Asset Tag are 6-digit numbers.
 * @param {string} id - The inputted ID.
 * @param {string} assetTag - The inputted Asset Tag.
 * @returns {boolean|string} - Returns true if valid, otherwise an error message.
 */
function validateInput(id, assetTag) {
  var sixDigitPattern = /^\d{6}$/; // Regex: Must be exactly 6 digits (0-9)

  if (!sixDigitPattern.test(id) || !sixDigitPattern.test(assetTag)) {
    return "Asset Tag and ID must be a 6-digit number (i.e., 123456). Please check your input and try again.";
  }

  return true;
}

/**
 * Records a sign-out event if the Asset Tag exists in inventory.
 * @param {string} name - Borrower's name.
 * @param {string} id - 6-digit borrower ID.
 * @param {string} assetTag - Asset tag of the device.
 * @returns {string} - Confirmation message or error.
 */
function recordSignOut(name, id, assetTag) {
  var validation = validateInput(id, assetTag);
  if (validation !== true) {
    Logger.log("Validation Error: " + validation);
    return validation;
  }

  if (!isValidAssetTag(assetTag)) {
    Logger.log("ERROR: Asset Tag not found in inventory: " + assetTag);
    return "No Such Loaner in Inventory. Please check Asset Tag and try again.";
  }

  var sheet = getMonthlySheet();
  var dateTime = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

  if (!name || !id || !assetTag) {
    Logger.log("ERROR: Missing required fields.");
    return "Error: Please fill in all fields.";
  }

  sheet.appendRow([name, id, assetTag, dateTime, ""]);
  Logger.log("Sign-out recorded -> Name: " + name + ", ID: " + id + ", Asset Tag: " + assetTag + ", Time: " + dateTime);
  
  return "Sign-Out Successful!";
}

/**
 * Records a sign-in event by updating the corresponding row based on Asset Tag.
 * @param {string} assetTag - Asset Tag of the device being returned.
 * @returns {string} - Confirmation message or error.
 */
function recordSignIn(assetTag) {
  var sheet = getMonthlySheet();
  var data = sheet.getDataRange().getValues();
  var signInTime = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

  if (!assetTag) {
    Logger.log("ERROR: Missing Asset Tag for sign-in.");
    return "Error: Please enter an Asset Tag.";
  }

  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][2] == assetTag && data[i][4] === "") { // Find first open sign-out entry
      sheet.getRange(i + 1, 5).setValue(signInTime);
      Logger.log("Sign-in recorded -> Asset Tag: " + assetTag + ", Time: " + signInTime);
      return "Sign-In Successful!";
    }
  }

  Logger.log("WARNING: No matching sign-out found for Asset Tag: " + assetTag);
  return "Error: No record of this Asset Tag being signed out.";
}

/**
 * Runs daily to check overdue sign-outs (12+ hours overdue) and sends a single report.
 */
function checkOverdueLoaners() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheets = ss.getSheets();
  var now = new Date();
  var overdueEntries = [];

  Logger.log("Running daily overdue check...");

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][4] === "" && data[i][3]) { // If not signed in
        var signedOutTime = new Date(data[i][3]);
        var hoursDiff = (now - signedOutTime) / (1000 * 60 * 60);

        if (hoursDiff > 12) {
          overdueEntries.push(
            `Name: ${data[i][0]}\nID: ${data[i][1]}\nAsset Tag: ${data[i][2]}\nSigned Out: ${data[i][3]}\n`
          );
        }
      }
    }
  }

  if (overdueEntries.length > 0) {
    var message = `🚨 **Overdue Loaner Report** 🚨\n\nThe following devices are overdue (signed out for more than 12 hours):\n\n`;
    message += overdueEntries.join("\n----------------------\n");

    MailApp.sendEmail({
      to: EMAIL_RECIPIENTS.join(","),
      subject: "Daily Overdue Loaner Report",
      body: message
    });

    Logger.log("Daily overdue email sent with " + overdueEntries.length + " overdue records.");
  } else {
    Logger.log("No overdue loaners found.");
  }

  Logger.log("Daily overdue check completed.");
}