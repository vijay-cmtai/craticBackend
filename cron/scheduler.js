const cron = require("node-cron");
const axios = require("axios");
const ftp = require("basic-ftp");
const Supplier = require("../models/supplierModel");
const { syncInventoryFromApi } = require("../services/inventoryService");

const startInventorySync = (io) => {
  console.log("🕒 Cron job scheduler has started.");
  cron.schedule("0 * * * *", async () => {
    console.log("⏰ Hourly inventory sync job is running...");
    const activeSuppliers = await Supplier.find({ isActive: true });
    if (activeSuppliers.length === 0) return;

    for (const supplier of activeSuppliers) {
      console.log(`Syncing data for supplier: ${supplier.name}`);
      try {
        const mappingObject = supplier.mapping
          ? Object.fromEntries(supplier.mapping.entries())
          : {};
        let result;

        if (supplier.apiUrl) {
          result = await syncInventoryFromApi(
            supplier.apiUrl,
            mappingObject,
            supplier.user
          );
        } else if (supplier.ftpInfo && supplier.ftpInfo.host) {
          // FTP logic needs to be inside syncInventory service or duplicated here.
          // For now, let's assume API is the primary method for cron.
          console.log(
            `FTP sync for ${supplier.name} is not configured for cron. Skipping.`
          );
          continue; // Skip to next supplier
        } else {
          console.log(`No API URL or FTP info for ${supplier.name}. Skipping.`);
          continue;
        }

        supplier.lastSyncDate = new Date();
        supplier.lastSyncStatus = result.success
          ? `Success: ${result.newDiamondsAdded} new, ${result.diamondsUpdated} updated, ${result.diamondsRemoved} removed.`
          : `Failed: ${result.message}`;
        await supplier.save();

        if (
          result.success &&
          (result.newDiamondsAdded > 0 ||
            result.diamondsUpdated > 0 ||
            result.diamondsRemoved > 0)
        ) {
          io.emit("inventory-updated", {
            message: `Inventory from ${supplier.name} automatically updated.`,
            ...result,
          });
        }
      } catch (error) {
        console.error(
          `Failed to sync for supplier ${supplier.name}: ${error.message}`
        );
        supplier.lastSyncStatus = `Failed: ${error.message}`;
        await supplier.save();
      }
    }
  });
};

module.exports = { startInventorySync };
