export function createConfigurationController({
  Swal,
  elements,
  api,
  formatTime,
  showToast,
  refreshJobs,
  applicationFieldLabels,
  confirmDeletion,
}) {
  let apiKeyConfigured = false;
  let importedAiModels = [];
  let importedAiBaseUrl = "";
  let applicationConfig = null;
  let aiConfig = {
    configured: false,
    baseUrl: "",
    hasToken: false,
    tokenHint: null,
    models: [],
    defaultModel: null,
    templates: [],
    updatedAt: null,
  };

  function selectConfigTab(name, { focus = false } = {}) {
    elements.configTabs.forEach((tab) => {
      const active = tab.dataset.configTab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) {
        tab.focus();
      }
    });
    elements.configPanels.forEach((panel) => {
      panel.hidden = panel.dataset.configPanel !== name;
    });
  }
  
  function syncForceOcrAvailability() {
    const disabled = elements.appOcrMode.value === "off";
    elements.appForceOcr.disabled = disabled;
    elements.appForceOcrWrapper.classList.toggle("disabled", disabled);
    if (disabled) {
      elements.appForceOcr.checked = false;
    }
  }

  const ocrLanguageInformation = {
    indonesia:
      "Bahasa Indonesia memakai model English RapidOCR yang kompatibel dengan aksara Latin dan mempertahankan spasi antarkata.",
    english:
      "Gunakan untuk dokumen berbahasa Inggris dan teks umum beraksara Latin.",
    chinese:
      "Gunakan hanya untuk dokumen Chinese. Model ini dapat menghilangkan spasi jika dipakai pada teks Latin.",
  };

  function syncOcrLanguageInformation() {
    elements.appOcrLanguageHelp.textContent =
      ocrLanguageInformation[elements.appOcrLanguage.value] ??
      "Pilihan ini diteruskan ke engine OCR saat aplikasi direstart.";
  }

  function syncUploadSizeInformation(result) {
    const configuredSize = result.settings.maxFileSizeMb;
    const activeSize = result.activeSettings?.maxFileSizeMb ?? configuredSize;
    const overridden = (result.environmentOverrides ?? []).some(
      ({ field }) => field === "maxFileSizeMb",
    );
    elements.uploadSizeLimit.textContent = overridden
      ? `PDF · maksimum ${activeSize} MB per file · diatur lewat environment`
      : configuredSize !== activeSize
        ? `PDF · maksimum ${activeSize} MB per file · ${configuredSize} MB setelah restart`
        : `PDF · maksimum ${activeSize} MB per file`;
  }
  
  function renderApplicationConfig(result) {
    applicationConfig = result;
    const settings = result.settings;
    elements.appOcrDevice.value = settings.ocrDevice;
    elements.appOcrMode.value = settings.ocrMode;
    elements.appForceOcr.checked = settings.forceOcr;
    elements.appLowMemoryMode.checked = settings.lowMemoryMode;
    elements.appOcrIdleMinutes.value = settings.ocrIdleMinutes;
    elements.appOcrLanguage.value = settings.ocrLanguage;
    elements.appMaxFileSize.value = settings.maxFileSizeMb;
    elements.appAiTimeout.value = settings.aiTimeoutSeconds;
    elements.appSessionHours.value = settings.sessionHours;
    syncForceOcrAvailability();
    syncOcrLanguageInformation();
    syncUploadSizeInformation(result);
  
    elements.appRestartNotice.hidden = !result.restartRequired;
    const hasOverrides = (result.environmentOverrides ?? []).length > 0;
    elements.appConfigState.textContent = result.restartRequired
      ? "Menunggu restart"
      : hasOverrides
        ? "Override aktif"
        : "Aktif";
    elements.appConfigState.classList.toggle("pending", result.restartRequired);
    elements.appConfigState.classList.toggle(
      "overridden",
      !result.restartRequired && hasOverrides,
    );
    elements.appRestartFields.textContent = result.restartRequired
      ? `${result.restartFields.map((field) => applicationFieldLabels[field] ?? field).join(", ")} akan aktif setelah restart.`
      : "Semua pengaturan sudah aktif.";
  
    const overrides = result.environmentOverrides ?? [];
    elements.appEnvironmentOverrides.hidden = overrides.length === 0;
    if (overrides.length > 0) {
      const title = document.createElement("strong");
      title.textContent = "Override environment aktif";
      const copy = document.createElement("p");
      copy.textContent = "Nilai berikut tetap mengikuti environment variable saat aplikasi dinyalakan:";
      const values = document.createElement("div");
      values.append(
        ...overrides.map(({ field, variable }) => {
          const code = document.createElement("code");
          code.textContent = `${applicationFieldLabels[field] ?? field}: ${variable}`;
          return code;
        }),
      );
      elements.appEnvironmentOverrides.replaceChildren(title, copy, values);
    }
  }
  
  async function refreshApplicationConfig() {
    const response = await api("/auth/app-config");
    renderApplicationConfig(await response.json());
  }
  
  function collectApplicationSettings() {
    return {
      ocrDevice: elements.appOcrDevice.value,
      ocrMode: elements.appOcrMode.value,
      forceOcr: elements.appForceOcr.checked,
      lowMemoryMode: elements.appLowMemoryMode.checked,
      ocrIdleMinutes: Number(elements.appOcrIdleMinutes.value),
      ocrLanguage: elements.appOcrLanguage.value.trim(),
      maxFileSizeMb: Number(elements.appMaxFileSize.value),
      aiTimeoutSeconds: Number(elements.appAiTimeout.value),
      sessionHours: Number(elements.appSessionHours.value),
    };
  }
  
  async function saveApplicationConfig() {
    const controls = [
      elements.appOcrLanguage,
      elements.appOcrIdleMinutes,
      elements.appMaxFileSize,
      elements.appAiTimeout,
      elements.appSessionHours,
    ];
    const invalid = controls.find((control) => !control.reportValidity());
    if (invalid) {
      invalid.focus();
      return;
    }
    elements.saveAppConfig.disabled = true;
    elements.appConfigWarning.hidden = true;
    try {
      const response = await api("/auth/app-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectApplicationSettings()),
      });
      renderApplicationConfig(await response.json());
      showToast("Pengaturan disimpan. Restart PDF2AI untuk menerapkannya.");
    } catch (error) {
      elements.appConfigWarning.textContent = error.message;
      elements.appConfigWarning.hidden = false;
    } finally {
      elements.saveAppConfig.disabled = false;
    }
  }
  
  function renderApiKeyStatus(status) {
    apiKeyConfigured = status.configured;
    if (elements.apiKeyBadge) {
      elements.apiKeyBadge.textContent = status.configured ? "Aktif" : "Nonaktif";
      elements.apiKeyBadge.className = `api-key-badge ${status.configured ? "is-active" : "is-inactive"}`;
    }
    elements.apiKeyStatus.textContent = status.configured
      ? "API key aktif dan siap digunakan"
      : "Belum ada API key";
    elements.apiKeyMetadata.textContent = status.configured
      ? `Dibuat pada ${formatTime(status.createdAt)}.`
      : "Buat key untuk mengaktifkan akses API eksternal bagi client atau automation.";
    if (elements.apiKeySpecs) {
      elements.apiKeySpecs.hidden = !status.configured;
    }
    if (elements.apiKeyPrefixVal) {
      elements.apiKeyPrefixVal.textContent = status.prefix ? `${status.prefix}…` : "-";
    }
    elements.generateApiKey.textContent = status.configured
      ? "Rotasi API key"
      : "Buat API key";
    elements.revokeApiKey.disabled = !status.configured;
  }
  
  async function refreshApiKeyStatus() {
    elements.apiKeyReveal.hidden = true;
    elements.apiKeyValue.textContent = "";
    elements.apiKeyWarning.hidden = true;
    try {
      const response = await api("/auth/api-key");
      renderApiKeyStatus(await response.json());
    } catch (error) {
      elements.apiKeyWarning.textContent = error.message;
      elements.apiKeyWarning.hidden = false;
    }
  }
  
  function closeConfiguration() {
    elements.aiToken.value = "";
    elements.apiKeyValue.textContent = "";
    elements.apiKeyReveal.hidden = true;
    elements.configDialog.close();
  }
  
  async function openConfiguration(initialTab = "app") {
    elements.appConfigWarning.hidden = true;
    elements.aiConfigWarning.hidden = true;
    elements.aiToken.value = "";
    selectConfigTab(initialTab);
    elements.configDialog.showModal();
    const results = await Promise.allSettled([
      refreshApplicationConfig(),
      refreshAiConfig(),
      refreshApiKeyStatus(),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      showToast(failed.reason.message, "error");
    }
    elements.aiBaseUrl.value = aiConfig.baseUrl;
    renderImportedModels();
    renderTemplateEditors(aiConfig.templates);
  }
  
  async function generateApiKey() {
    if (apiKeyConfigured) {
      const confirmed = await confirmDeletion({
        title: "Rotasi API key?",
        text: "API key lama akan langsung berhenti berfungsi dan tidak dapat digunakan kembali.",
        confirmButtonText: "Ya, rotasi key",
      });
      if (!confirmed) {
        return;
      }
    }
  
    elements.generateApiKey.disabled = true;
    try {
      const response = await api("/auth/api-key", { method: "POST" });
      const result = await response.json();
      elements.apiKeyValue.textContent = result.apiKey;
      elements.apiKeyReveal.hidden = false;
      renderApiKeyStatus({ configured: true, ...result });
      showToast("API key baru berhasil dibuat.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      elements.generateApiKey.disabled = false;
    }
  }
  
  async function revokeApiKey() {
    if (
      !(await confirmDeletion({
        title: "Cabut API key?",
        text: "Client eksternal akan langsung kehilangan akses ke seluruh endpoint terproteksi.",
        confirmButtonText: "Cabut API key",
      }))
    ) {
      return;
    }
    elements.revokeApiKey.disabled = true;
    try {
      await api("/auth/api-key", { method: "DELETE" });
      elements.apiKeyReveal.hidden = true;
      renderApiKeyStatus({ configured: false });
      showToast("API key telah dicabut.");
    } catch (error) {
      showToast(error.message, "error");
      elements.revokeApiKey.disabled = false;
    }
  }
  
  function renderAiConfigStatus() {
    elements.aiConfigStatusText.textContent = aiConfig.configured
      ? "AI siap digunakan"
      : "Belum dikonfigurasi";
    const details = [];
    if (aiConfig.models.length > 0) {
      details.push(`${aiConfig.models.length} model`);
    }
    if (aiConfig.defaultModel) {
      details.push(`default ${aiConfig.defaultModel}`);
    }
    if (aiConfig.hasToken) {
      details.push(`token ${aiConfig.tokenHint}`);
    }
    if (aiConfig.updatedAt) {
      details.push(`diperbarui ${formatTime(aiConfig.updatedAt)}`);
    }
    elements.aiConfigStatusMeta.textContent = details.join(" · ") ||
      "Hubungkan provider OpenAI-compatible untuk mengaktifkan Tanya AI.";
    elements.deleteAiConfig.disabled = !aiConfig.configured;
    elements.aiTokenHint.textContent = aiConfig.hasToken
      ? `Token tersimpan: ${aiConfig.tokenHint}. Kosongkan untuk mempertahankannya.`
      : "Token opsional untuk provider lokal dan tidak pernah ditampilkan kembali.";
  }
  
  async function refreshAiConfig() {
    try {
      const response = await api("/auth/ai-config");
      aiConfig = await response.json();
      importedAiModels = [...aiConfig.models];
      importedAiBaseUrl = aiConfig.baseUrl;
      renderAiConfigStatus();
    } catch (error) {
      showToast(error.message, "error");
    }
  }
  
  function renderImportedModels() {
    const preferredDefault = elements.aiDefaultModel.value || aiConfig.defaultModel;
    if (importedAiModels.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "Belum ada model yang diimpor.";
      elements.aiModelList.replaceChildren(empty);
      elements.aiDefaultModel.replaceChildren(
        new Option("Import model terlebih dahulu", ""),
      );
      elements.aiDefaultModel.disabled = true;
      return;
    }
    elements.aiModelList.replaceChildren(
      ...importedAiModels.map((model) => {
        const item = document.createElement("code");
        item.textContent = model;
        return item;
      }),
    );
    elements.aiDefaultModel.replaceChildren(
      ...importedAiModels.map((model) => new Option(model, model)),
    );
    elements.aiDefaultModel.value = importedAiModels.includes(preferredDefault)
      ? preferredDefault
      : importedAiModels[0];
    elements.aiDefaultModel.disabled = false;
  }
  
  function createTemplateEditor(template = {}) {
    const editor = document.createElement("article");
    editor.className = "ai-template-editor";
    editor.dataset.templateId = template.id || crypto.randomUUID();
  
    const nameField = document.createElement("label");
    nameField.className = "form-field";
    const nameLabel = document.createElement("span");
    nameLabel.textContent = "Nama template";
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 100;
    name.placeholder = "Contoh: Ringkasan eksekutif";
    name.value = template.name || "";
    name.dataset.templateName = "";
    nameField.append(nameLabel, name);
  
    const promptField = document.createElement("label");
    promptField.className = "form-field ai-template-prompt";
    const promptLabel = document.createElement("span");
    promptLabel.textContent = "Isi pertanyaan";
    const prompt = document.createElement("textarea");
    prompt.rows = 4;
    prompt.maxLength = 20_000;
    prompt.placeholder = "Tuliskan instruksi yang dapat dipakai berulang kali…";
    prompt.value = template.prompt || "";
    prompt.dataset.templatePrompt = "";
    promptField.append(promptLabel, prompt);
  
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button danger-text-button";
    remove.textContent = "Hapus template";
    remove.addEventListener("click", () => {
      editor.remove();
      elements.aiTemplateEmpty.hidden = elements.aiTemplateList.children.length > 0;
    });
  
    editor.append(nameField, promptField, remove);
    return editor;
  }
  
  function renderTemplateEditors(templates) {
    elements.aiTemplateList.replaceChildren(
      ...templates.map((template) => createTemplateEditor(template)),
    );
    elements.aiTemplateEmpty.hidden = templates.length > 0;
  }
  
  function collectTemplates() {
    return [...elements.aiTemplateList.children].map((editor) => ({
      id: editor.dataset.templateId,
      name: editor.querySelector("[data-template-name]").value.trim(),
      prompt: editor.querySelector("[data-template-prompt]").value.trim(),
    }));
  }
  
  async function importAiModels() {
    const baseUrl = elements.aiBaseUrl.value.trim();
    if (!baseUrl) {
      elements.aiBaseUrl.focus();
      showToast("Isi Base URL AI terlebih dahulu.", "error");
      return;
    }
    const payload = { baseUrl };
    if (elements.aiToken.value) {
      payload.token = elements.aiToken.value;
    }
    elements.aiImportModels.disabled = true;
    elements.aiImportModels.textContent = "Memeriksa…";
    elements.aiConfigWarning.hidden = true;
    try {
      const response = await api("/auth/ai-config/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      elements.aiBaseUrl.value = result.baseUrl;
      importedAiModels = result.models;
      importedAiBaseUrl = result.baseUrl;
      renderImportedModels();
      showToast(`${result.models.length} model berhasil diimpor.`);
    } catch (error) {
      elements.aiConfigWarning.textContent = error.message;
      elements.aiConfigWarning.hidden = false;
    } finally {
      elements.aiImportModels.disabled = false;
      elements.aiImportModels.textContent = "Cek & import model";
    }
  }
  
  async function saveAiConfiguration() {
    const templates = collectTemplates();
    if (templates.some((template) => !template.name || !template.prompt)) {
      showToast("Lengkapi nama dan isi semua template.", "error");
      return;
    }
    if (importedAiModels.length === 0) {
      showToast("Cek koneksi dan import model terlebih dahulu.", "error");
      return;
    }
    if (elements.aiBaseUrl.value.trim().replace(/\/+$/, "") !== importedAiBaseUrl) {
      showToast("Base URL berubah. Cek dan import model kembali.", "error");
      return;
    }
    const payload = {
      baseUrl: elements.aiBaseUrl.value.trim(),
      models: importedAiModels,
      defaultModel: elements.aiDefaultModel.value,
      templates,
    };
    if (elements.aiToken.value) {
      payload.token = elements.aiToken.value;
    }
  
    elements.saveAiConfig.disabled = true;
    elements.aiConfigWarning.hidden = true;
    try {
      const response = await api("/auth/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      aiConfig = await response.json();
      importedAiModels = [...aiConfig.models];
      importedAiBaseUrl = aiConfig.baseUrl;
      renderAiConfigStatus();
      await refreshJobs?.({ quiet: true });
      showToast("Konfigurasi AI berhasil disimpan.");
    } catch (error) {
      elements.aiConfigWarning.textContent = error.message;
      elements.aiConfigWarning.hidden = false;
    } finally {
      elements.saveAiConfig.disabled = false;
    }
  }
  
  async function deleteAiConfiguration() {
    if (
      !(await confirmDeletion({
        title: "Hapus konfigurasi AI?",
        text: "Base URL, token, model, dan template akan dihapus. Hasil Tanya AI yang sudah tersimpan tetap tersedia.",
        confirmButtonText: "Hapus konfigurasi",
      }))
    ) {
      return;
    }
    try {
      await api("/auth/ai-config", { method: "DELETE" });
      aiConfig = {
        configured: false,
        baseUrl: "",
        hasToken: false,
        tokenHint: null,
        models: [],
        defaultModel: null,
        templates: [],
        updatedAt: null,
      };
      importedAiModels = [];
      importedAiBaseUrl = "";
      renderAiConfigStatus();
      await refreshJobs?.({ quiet: true });
      elements.aiBaseUrl.value = "";
      elements.aiToken.value = "";
      renderImportedModels();
      renderTemplateEditors([]);
      showToast("Konfigurasi AI telah dihapus.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function exportConfigurationData() {
    const originalText = elements.exportConfigBtn?.textContent;
    if (elements.exportConfigBtn) {
      elements.exportConfigBtn.disabled = true;
      elements.exportConfigBtn.textContent = "Mengekspor…";
    }
    try {
      const response = await api("/v1/backup/config/export");
      const blob = await response.blob();
      const dateStr = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pdf2ai-config-${dateStr}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast("Konfigurasi berhasil diexport.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      if (elements.exportConfigBtn) {
        elements.exportConfigBtn.disabled = false;
        elements.exportConfigBtn.textContent = originalText;
      }
    }
  }

  async function importConfigurationData(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const inputElement = event.target;

    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("File bukan JSON yang valid.");
      }

      const confirm = await Swal.fire({
        title: "Terapkan konfigurasi?",
        text: "Pengaturan aplikasi, AI provider, dan prompt template akan diperbarui.",
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Ya, terapkan",
        cancelButtonText: "Batal",
      });
      if (!confirm.isConfirmed) {
        inputElement.value = "";
        return;
      }

      Swal.fire({
        title: "Mengimpor konfigurasi…",
        text: "Menerapkan konfigurasi dan memperbarui pengaturan sistem.",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });

      const response = await api("/v1/backup/config/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const result = await response.json();

      await Swal.fire({
        title: "Berhasil!",
        text:
          (result.message || "Konfigurasi berhasil diterapkan.") +
          " Halaman akan dimuat ulang untuk memperbarui seluruh tampilan.",
        icon: "success",
        confirmButtonText: "Muat Ulang",
        allowOutsideClick: false,
      });
      window.location.reload();
    } catch (error) {
      Swal.fire({
        title: "Gagal mengimpor konfigurasi",
        text: error.message,
        icon: "error",
      });
    } finally {
      inputElement.value = "";
    }
  }

  async function exportCompleteData() {
    const originalText = elements.exportDataBtn?.textContent;
    if (elements.exportDataBtn) {
      elements.exportDataBtn.disabled = true;
      elements.exportDataBtn.textContent = "Mengemas ZIP…";
    }
    Swal.fire({
      title: "Menyiapkan arsip ZIP…",
      text: "Mohon tunggu sebentar, seluruh riwayat data sedang dikemas.",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const includePdfs = elements.backupIncludePdf.checked ? "true" : "false";
      const response = await api(
        `/v1/backup/data/export?includePdfs=${includePdfs}`,
      );
      const blob = await response.blob();
      const dateStr = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pdf2ai-data-${dateStr}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      Swal.close();
      showToast("Data arsip berhasil diunduh.");
    } catch (error) {
      Swal.fire({
        title: "Gagal mengekspor data",
        text: error.message,
        icon: "error",
      });
    } finally {
      if (elements.exportDataBtn) {
        elements.exportDataBtn.disabled = false;
        elements.exportDataBtn.textContent = originalText;
      }
    }
  }

  async function importCompleteData(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const inputElement = event.target;

    try {
      const confirm = await Swal.fire({
        title: "Pulihkan / Import Data?",
        text: `File "${file.name}" akan diekstrak dan digabungkan ke riwayat antrean dokumen dan AI.`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Ya, pulihkan data",
        cancelButtonText: "Batal",
      });
      if (!confirm.isConfirmed) {
        inputElement.value = "";
        return;
      }

      Swal.fire({
        title: "Mengimpor data dokumen…",
        text: "Mohon tunggu, proses ekstraksi arsip sedang berjalan.",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });

      const formData = new FormData();
      formData.append("file", file);

      const response = await api("/v1/backup/data/import", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      await Swal.fire({
        title: "Data Berhasil Dipulihkan!",
        html: `<p>${result.message || "Data berhasil diimpor."}</p>
               <ul style="text-align: left; margin: 12px auto; display: inline-block;">
                 <li><strong>${result.importedJobs ?? 0}</strong> Dokumen / Job</li>
                 <li><strong>${result.importedAiResults ?? 0}</strong> Hasil Analisis AI</li>
                 <li><strong>${result.importedFolders ?? 0}</strong> Folder Baru</li>
               </ul>
               <p style="margin-top: 10px; font-size: 13px; color: var(--muted, #666);">Halaman akan dimuat ulang untuk memuat seluruh konten.</p>`,
        icon: "success",
        confirmButtonText: "Muat Ulang",
        allowOutsideClick: false,
      });
      window.location.reload();
    } catch (error) {
      Swal.fire({
        title: "Gagal mengimpor data",
        text: error.message,
        icon: "error",
      });
    } finally {
      inputElement.value = "";
    }
  }

  return {
    get aiConfig() {
      return aiConfig;
    },
    closeConfiguration,
    createTemplateEditor,
    deleteAiConfiguration,
    exportCompleteData,
    exportConfigurationData,
    generateApiKey,
    importAiModels,
    importCompleteData,
    importConfigurationData,
    openConfiguration,
    refreshAiConfig,
    refreshApplicationConfig,
    revokeApiKey,
    saveAiConfiguration,
    saveApplicationConfig,
    selectConfigTab,
    syncForceOcrAvailability,
    syncOcrLanguageInformation,
  };
}
