export function createConfigurationController({
  Swal,
  elements,
  api,
  formatTime,
  showToast,
  refreshJobs,
  applicationFieldLabels,
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
      ocrLanguage: elements.appOcrLanguage.value.trim(),
      maxFileSizeMb: Number(elements.appMaxFileSize.value),
      aiTimeoutSeconds: Number(elements.appAiTimeout.value),
      sessionHours: Number(elements.appSessionHours.value),
    };
  }
  
  async function saveApplicationConfig() {
    const controls = [
      elements.appOcrLanguage,
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
      renderJobs(latestJobs);
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
      renderJobs(latestJobs);
      renderAiConfigStatus();
      elements.aiBaseUrl.value = "";
      elements.aiToken.value = "";
      renderImportedModels();
      renderTemplateEditors([]);
      showToast("Konfigurasi AI telah dihapus.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }
  

  return {
    get aiConfig() {
      return aiConfig;
    },
    closeConfiguration,
    createTemplateEditor,
    deleteAiConfiguration,
    generateApiKey,
    importAiModels,
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
