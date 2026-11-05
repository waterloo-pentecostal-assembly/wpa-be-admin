import React, { useState, useEffect, useRef } from 'react';
import { FileText, Save, Plus, Loader2, Download, BookOpen, CloudUpload, Upload, Sparkles } from 'lucide-react';
import Header from './components/Header';
import SeriesForm from './components/SeriesForm';
import ContentList from './components/ContentList';
import EngagementEditor from './components/EngagementEditor';
import ScripturePicker from './components/ScripturePicker';
import ConfirmModal from './components/ConfirmModal';
import AiGeneratorModal from './components/AiGeneratorModal';

function BibleSeriesManager() {
  const [seriesList, setSeriesList] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [bibleSeries, setBibleSeries] = useState(null);
  const [seriesContent, setSeriesContent] = useState([]);
  const [loading, setLoading] = useState(false);

  // Editor State
  const [editingIndex, setEditingIndex] = useState(null); // null = not editing
  const [editingEntry, setEditingEntry] = useState(null);
  const [showScripturePicker, setShowScripturePicker] = useState(false);
  const [activeScriptureBlockIndex, setActiveScriptureBlockIndex] = useState(null);
  const [editingScriptureIndex, setEditingScriptureIndex] = useState(null); // null = adding new
  const [pickerInitialSelection, setPickerInitialSelection] = useState(null);
  const [showAiGenerator, setShowAiGenerator] = useState(false);

  const fileInputRef = useRef(null);

  // ... (rest of code) ...

  const handleOpenScripturePicker = (blockIndex, scriptureIndex = null) => {
    setActiveScriptureBlockIndex(blockIndex);
    setEditingScriptureIndex(scriptureIndex);

    // If editing existing, pass data to picker
    if (scriptureIndex !== null) {
      const block = editingEntry.body[blockIndex];
      const scripture = block.scriptures[scriptureIndex];
      setPickerInitialSelection(scripture);
    } else {
      setPickerInitialSelection(null);
    }

    setShowScripturePicker(true);
  };

  const handleScriptureSelected = (scriptureData) => {
    const newEntry = { ...editingEntry };
    const block = newEntry.body[activeScriptureBlockIndex];
    if (!block.scriptures) block.scriptures = [];

    if (editingScriptureIndex !== null) {
      // Update existing
      block.scriptures[editingScriptureIndex] = scriptureData;
    } else {
      // Add new
      block.scriptures.push(scriptureData);
    }

    setEditingEntry(newEntry);
    setShowScripturePicker(false);
    setActiveScriptureBlockIndex(null);
    setEditingScriptureIndex(null);
    setPickerInitialSelection(null);
  };
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);

  useEffect(() => {
    fetchSeriesList();
  }, []);

  const fetchSeriesList = async () => {
    try {
      const res = await fetch('/api/series');
      const data = await res.json();
      setSeriesList(data);
    } catch (err) {
      console.error("Failed to fetch series list", err);
    }
  };

  const loadSeries = async (filename) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/series/${filename}`);
      const data = await res.json();
      setBibleSeries(data.bible_series);
      setSeriesContent(data.series_content || []);
      setSelectedFile(filename);
      setEditingIndex(null);
    } catch (err) {
      console.error("Failed to load series", err);
    } finally {
      setLoading(false);
    }
  };

  const createNewSeries = async () => {
    const name = window.prompt("Enter Series Name:");
    if (!name) return;

    const filename = name.toLowerCase().trim().replace(/\s+/g, '_') + '.json';

    if (seriesList.includes(filename)) {
      alert('A series with this filename already exists. Please choose a different name.');
      return;
    }

    const newSeriesData = {
      bible_series: {
        title: name,
        sub_title: '',
        image_gs_location: '',
        is_active: false,
        is_visible: false
      },
      series_content: []
    };

    try {
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          content: newSeriesData,
          checkExists: true
        })
      });

      if (res.ok) {
        await fetchSeriesList();
        setSelectedFile(filename);
        setBibleSeries(newSeriesData.bible_series);
        setSeriesContent(newSeriesData.series_content);
        setEditingIndex(null);
      } else if (res.status === 409) {
        alert('A series with this filename already exists on the server. Please choose a different name.');
      } else {
        alert('Failed to create new series file');
      }
    } catch (err) {
      console.error('Error creating new series:', err);
      alert('Error creating new series');
    }
  };

  const handleLoadJsonClick = () => {
    fileInputRef.current.click();
  };

  const handleJsonFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Reset value so same file can be selected again if needed
    e.target.value = null;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonContent = JSON.parse(event.target.result);

        // Basic validation - check if it looks like a series
        if (!jsonContent.bible_series && !jsonContent.series_content) {
          // Try to see if it's the structure { title: ..., content: ... } or just the bible_series object?
          // For now assume standard export format { bible_series, series_content }
          if (!jsonContent.title) {
            // Maybe it's just raw content? Let's assume strict format for now based on current export
            alert("Invalid JSON format. Expected an export from this tool.");
            return;
          }
        }

        // Normalize data
        let importedSeries = jsonContent.bible_series;
        let importedContent = jsonContent.series_content || [];

        // If simple format (just the object)
        if (!importedSeries && jsonContent.title) {
          importedSeries = jsonContent;
          importedContent = [];
        }

        const name = window.prompt("Enter Series Name for the new file:", importedSeries.title || file.name.replace('.json', ''));
        if (!name) return;

        const filename = name.toLowerCase().trim().replace(/\s+/g, '_') + '.json';

        const newSeriesData = {
          bible_series: importedSeries,
          series_content: importedContent
        };

        try {
          const res = await fetch('/api/series', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename,
              content: newSeriesData,
              checkExists: true
            })
          });

          if (res.ok) {
            await fetchSeriesList();
            setSelectedFile(filename);
            setBibleSeries(newSeriesData.bible_series);
            setSeriesContent(newSeriesData.series_content);
            setEditingIndex(null);
            alert('Series loaded and saved successfully!');
          } else if (res.status === 409) {
            alert('A series with this filename already exists on the server. Please check the name or delete the existing file.');
          } else {
            alert('Failed to save loaded series');
          }
        } catch (err) {
          console.error('Error saving loaded series:', err);
          alert('Error saving loaded series');
        }

      } catch (err) {
        console.error("Error parsing JSON", err);
        alert("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
  };

  const handleAiGenerate = async (generatedData) => {
    setShowAiGenerator(false);

    if (!generatedData || !generatedData.bible_series) {
      alert("Invalid data returned from AI generation.");
      return;
    }

    const suggestedTitle = generatedData.bible_series.title || "New AI Series";
    const name = window.prompt("Enter Series Name for the generated file:", suggestedTitle);
    if (!name) return;

    const filename = name.toLowerCase().trim().replace(/\s+/g, '_') + '.json';

    if (seriesList.includes(filename)) {
      if (!confirm('A series with this filename already exists. Overwrite?')) {
        return;
      }
    }

    // Update generated title with whatever name the user chose
    generatedData.bible_series.title = name;

    try {
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          content: generatedData,
          checkExists: false
        })
      });

      if (res.ok) {
        await fetchSeriesList();
        setSelectedFile(filename);
        setBibleSeries(generatedData.bible_series);
        setSeriesContent(generatedData.series_content || []);
        setEditingIndex(null);
        alert('Series generated and saved successfully!');
      } else {
        alert('Failed to save generated series');
      }
    } catch (err) {
      console.error('Error saving generated series:', err);
      alert('Error saving generated series');
    }
  };

  const saveSeries = async () => {
    if (!selectedFile || !bibleSeries) return;

    // Sort content by date before saving
    const sortedContent = [...seriesContent].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date) - new Date(b.date);
    });

    const payload = {
      filename: selectedFile,
      content: {
        bible_series: bibleSeries,
        series_content: sortedContent
      }
    };

    try {
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (result.success) {
        alert('Saved successfully!');
        fetchSeriesList(); // Refresh list to catch name changes if applicable
      } else {
        alert('Error saving');
      }
    } catch (err) {
      alert('Error saving: ' + err.message);
    }
  };

  const handleDownloadJson = () => {
    if (!bibleSeries) return;

    const sortedContent = [...seriesContent].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date) - new Date(b.date);
    });

    const data = {
      bible_series: bibleSeries,
      series_content: sortedContent
    };

    const jsonString = JSON.stringify(data, null, 4);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFile || 'series.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Trigger the modal
  const handleUploadClick = () => {
    if (!bibleSeries) return;
    setShowUploadConfirm(true);
  };

  // Actual upload logic
  const handleConfirmUpload = async () => {
    setShowUploadConfirm(false);
    setLoading(true);
    try {
      const sortedContent = [...seriesContent].sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(a.date) - new Date(b.date);
      });

      const payload = {
        bible_series: bibleSeries,
        series_content: sortedContent
      };

      const res = await fetch('/api/series/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      alert(`Successfully uploaded series! ID: ${result.seriesId}`);
    } catch (err) {
      alert('Error uploading to Firebase: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Content List Actions
  const handleAddNewContent = () => {
    const newEntry = { date: '', content_type: 'read', body: [] };
    setEditingEntry(newEntry);
    setEditingIndex('new');
  };

  const handleEditContent = (idx) => {
    setEditingEntry(JSON.parse(JSON.stringify(seriesContent[idx]))); // Deep copy
    setEditingIndex(idx);
  };

  const handleDeleteContent = (idx) => {
    if (confirm('Are you sure you want to delete this entry?')) {
      const newContent = [...seriesContent];
      newContent.splice(idx, 1);
      setSeriesContent(newContent);
    }
  };

  const handleMoveContent = (idx, direction) => {
    const newContent = [...seriesContent];
    const temp = newContent[idx];
    newContent[idx] = newContent[idx + direction];
    newContent[idx + direction] = temp;
    setSeriesContent(newContent);
  };

  // Editor Actions
  const handleSaveEditor = () => {
    const newContent = [...seriesContent];
    if (editingIndex === 'new') {
      newContent.push(editingEntry);
    } else {
      newContent[editingIndex] = editingEntry;
    }
    setSeriesContent(newContent);
    setEditingIndex(null);
    setEditingEntry(null);
  };



  return (
    <div className="flex flex-col h-screen bg-canvas">
      <Header
        title="Series Creator"
        subtitle="Build, edit and publish Bible series content"
        icon={BookOpen}
        fullWidth
        actions={
          <>
            <button onClick={() => setShowAiGenerator(true)} className="btn btn-secondary btn-sm" title="Generate with AI">
              <Sparkles size={16} className="text-brand" />
              <span>Generate with AI</span>
            </button>
            <button onClick={handleLoadJsonClick} className="btn btn-secondary btn-sm" title="Load JSON">
              <Upload size={16} />
              <span>Load JSON</span>
            </button>
            <button onClick={createNewSeries} className="btn btn-primary btn-sm" title="New Series">
              <Plus size={16} />
              <span>New Series</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleJsonFileChange}
              accept=".json"
              className="hidden"
            />
          </>
        }
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - File List */}
        <aside className="w-72 bg-white border-r border-gray-200 flex flex-col z-10">
          <div className="px-4 pt-5 pb-3 flex items-center justify-between">
            <h2 className="section-label">Series Files</h2>
            <span className="text-xs font-bold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{seriesList.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
            {seriesList.map(file => (
              <div
                key={file}
                onClick={() => loadSeries(file)}
                className={`px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm ${selectedFile === file ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
              >
                <div className="flex items-center gap-2">
                  <FileText size={15} className={`shrink-0 ${selectedFile === file ? "text-brand" : "text-gray-400"}`} />
                  <span className="truncate">{file}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {bibleSeries ? (
            <div className="max-w-5xl mx-auto px-8 pb-20">
              <div className="flex flex-wrap justify-between items-center gap-4 mb-6 sticky top-0 bg-canvas/95 backdrop-blur py-5 z-10 border-b border-gray-200">
                <div className="min-w-0">
                  <p className="eyebrow mb-1">Editing Series</p>
                  <h1 className="page-title truncate">
                    {bibleSeries.title || 'Untitled Series'}
                  </h1>
                  <p className="text-sm text-gray-500 mt-0.5 font-mono truncate">{selectedFile}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {loading && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 px-2">
                      <Loader2 size={14} className="animate-spin text-brand" />
                      Loading...
                    </span>
                  )}
                  <button
                    onClick={handleDownloadJson}
                    className="btn btn-secondary"
                    title="Download JSON"
                  >
                    <Download size={16} />
                    <span>Download JSON</span>
                  </button>
                  <button
                    onClick={handleUploadClick}
                    className="btn btn-dark"
                    title="Upload to Firebase"
                  >
                    <CloudUpload size={16} />
                    <span>Upload to Firebase</span>
                  </button>
                  <button
                    onClick={saveSeries}
                    className="btn btn-primary"
                  >
                    <Save size={16} />
                    <span>Save Changes</span>
                  </button>
                </div>
              </div>

              <SeriesForm
                data={bibleSeries}
                onChange={setBibleSeries}
              />

              <div className="mt-8">
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-ink">Content Schedule</h2>
                    <p className="text-sm text-gray-500">{seriesContent.length} {seriesContent.length === 1 ? 'entry' : 'entries'}</p>
                  </div>
                  <button
                    onClick={handleAddNewContent}
                    className="btn btn-ghost-brand btn-sm"
                  >
                    <Plus size={16} />
                    <span>Add Content</span>
                  </button>
                </div>

                <ContentList
                  content={seriesContent}
                  onSelect={handleEditContent}
                  onDelete={handleDeleteContent}
                  onMove={handleMoveContent}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="w-20 h-20 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center mb-5">
                <BookOpen size={36} className="text-brand-300" />
              </div>
              <h3 className="text-lg font-bold text-ink">No Series Selected</h3>
              <p className="text-sm text-gray-500 mt-1">Select a file from the sidebar or create a new series.</p>
            </div>
          )}
        </div>

        {/* Overlays */}
        {editingIndex !== null && (
          <EngagementEditor
            entry={editingEntry}
            onChange={setEditingEntry}
            onCancel={() => setEditingIndex(null)}
            onSave={handleSaveEditor}
            onAddScripture={handleOpenScripturePicker} // Passed down prop
          />
        )}

        {showScripturePicker && (
          <ScripturePicker
            onSelect={handleScriptureSelected}
            onCancel={() => setShowScripturePicker(false)}
            initialSelection={pickerInitialSelection}
          />
        )}

        {showUploadConfirm && (
          <ConfirmModal
            title="Confirm Upload"
            message="This data will be duplicated in Firebase if it already exists, would you like to proceed?"
            onConfirm={handleConfirmUpload}
            onCancel={() => setShowUploadConfirm(false)}
            confirmText="Proceed"
            isDangerous={false} // Amber warning feels appropriate for duplication, not destruction
          />
        )}

        {showAiGenerator && (
          <AiGeneratorModal
            onGenerate={handleAiGenerate}
            onCancel={() => setShowAiGenerator(false)}
          />
        )}
      </div>
    </div>
  );
}

export default BibleSeriesManager;
