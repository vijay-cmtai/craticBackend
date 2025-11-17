// cron/scheduler.js

const cron = require("node-cron");
const User = require("../models/userModel"); 
const { syncInventoryFromApi } = require("../services/inventoryService");
const startInventorySync = (io) => {
  console.log("🕒 Cron job scheduler has started.");
  cron.schedule("*/5 * * * *", async () => {
    console.log("\n🚀 Running scheduled API inventory sync...");
    try {
      const suppliersToSync = await User.find({
        role: "Supplier",
        status: "Approved", 
        "apiSync.enabled": true,
        "apiSync.apiUrl": { $exists: true, $ne: "" }, 
      });

      if (suppliersToSync.length === 0) {
        console.log("-> No suppliers found for automatic sync. Job finished.");
        return;
      }
      console.log(`-> Found ${suppliersToSync.length} supplier(s) to sync.`);
      for (const supplier of suppliersToSync) {
        console.log(
          `  -> Syncing for supplier: ${supplier.name} (${supplier._id})`
        );
        const mappingObject = supplier.apiSync.apiMapping
          ? Object.fromEntries(supplier.apiSync.apiMapping.entries())
          : {};
        try {
          const result = await syncInventoryFromApi(
            supplier.apiSync.apiUrl,
            mappingObject,
            supplier._id 
          );

          supplier.apiSync.lastSyncDate = new Date();
          supplier.apiSync.lastSyncStatus = result.success
            ? `Success: ${result.newDiamondsAdded || 0} added, ${result.diamondsUpdated || 0} updated, ${result.diamondsRemoved || 0} removed.`
            : `Failed: ${result.message}`;

          console.log(
            `  -> Sync for ${supplier.name} completed. Status: ${result.success}`
          );
          if (io && result.success) {
            io.emit("auto-sync-update", {
              supplierName: supplier.name,
              status: "Success",
              details: result,
            });
          }
        } catch (error) {
          console.error(
            `  -> ❌ Error during sync for ${supplier.name}:`,
            error.message
          );
          supplier.apiSync.lastSyncStatus = `Error: ${error.message}`;
        }
        await supplier.save();
      }
    } catch (error) {
      console.error(
        "❌ A fatal error occurred during the cron job execution:",
        error
      );
    }
    console.log("✅ Scheduled API sync job finished.\n");
  });
};
module.exports = { startInventorySync };
