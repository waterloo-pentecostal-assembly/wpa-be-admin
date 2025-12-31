import React, { useState, useEffect } from 'react';
import { FileText, Save, Plus, Loader2, ArrowLeft, Download, BookOpen, CloudUpload } from 'lucide-react';
import { Link } from 'react-router-dom';
import Header from './components/Header';
import SeriesForm from './components/SeriesForm';
import ContentList from './components/ContentList';
import EngagementEditor from './components/EngagementEditor';
import ScripturePicker from './components/ScripturePicker';
import ConfirmModal from './components/ConfirmModal';

function BibleSeriesManager() {
  const [seriesList, setSeriesList] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [bibleSeries, setBibleSeries] = useState(null);
  const [seriesContent, setSeriesContent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [nivData, setNivData] = useState(null);

  // Editor State
  const [editingIndex, setEditingIndex] = useState(null); // null = not editing
  const [editingEntry, setEditingEntry] = useState(null);
  const [showScripturePicker, setShowScripturePicker] = useState(false);
  const [activeScriptureBlockIndex, setActiveScriptureBlockIndex] = useState(null);

  // Modal State
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);

  useEffect(() => {
    fetchSeriesList();
    fetchNivData();
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

  const fetchNivData = async () => {
    try {
      const res = await fetch('/api/niv');
      const data = await res.json();
      setNivData(data);
    } catch (err) {
      console.error("Failed to fetch NIV data", err);
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

  const createNewSeries = () => {
    setSelectedFile('new_series.json');
    setBibleSeries({
      title: 'New Series',
      sub_title: '',
      image_gs_location: '',
      is_active: false,
      is_visible: false
    });
    setSeriesContent([]);
    setEditingIndex(null);
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

  const handleOpenScripturePicker = (blockIndex) => {
    setActiveScriptureBlockIndex(blockIndex);
    setShowScripturePicker(true);
  };

  const handleScriptureSelected = (scriptureData) => {
    const newEntry = { ...editingEntry };
    const block = newEntry.body[activeScriptureBlockIndex];
    if (!block.scriptures) block.scriptures = [];
    block.scriptures.push(scriptureData);
    setEditingEntry(newEntry);
    setShowScripturePicker(false);
    setActiveScriptureBlockIndex(null);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <Header
        title="Series Creator"
        icon={BookOpen}
        fullWidth
        actions={
          <button onClick={createNewSeries} className="flex items-center space-x-2 bg-brand text-white px-3 py-1.5 rounded-md hover:bg-brand-600 transition-all shadow-sm text-sm" title="New Series">
            <Plus size={16} />
            <span>New Series</span>
          </button>
        }
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - File List */}
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col shadow-sm z-10">
          <div className="flex-1 overflow-y-auto pt-2">
            {seriesList.map(file => (
              <div
                key={file}
                onClick={() => loadSeries(file)}
                className={`px-4 py-3 cursor-pointer border-l-4 transition-colors text-sm ${selectedFile === file ? 'bg-brand-50 border-brand text-brand font-medium' : 'border-transparent text-gray-600 hover:bg-gray-50'}`}
              >
                <div className="flex items-center space-x-2">
                  <FileText size={14} className={selectedFile === file ? "text-brand" : "text-gray-400"} />
                  <span className="truncate">{file}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {bibleSeries ? (
            <div className="max-w-5xl mx-auto p-8 pb-20">
              <div className="flex justify-between items-center mb-8 sticky top-0 bg-gray-50/95 backdrop-blur py-4 z-10 border-b border-gray-200/50">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {bibleSeries.title || 'Untitled Series'}
                  </h1>
                  <p className="text-sm text-gray-500 mt-1">{selectedFile}</p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-xs text-gray-400 px-2">{loading ? 'Loading...' : ''}</span>
                  <button
                    onClick={handleDownloadJson}
                    className="flex items-center space-x-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-all shadow-sm hover:shadow active:scale-95"
                    title="Download JSON"
                  >
                    <Download size={18} />
                    <span>Download JSON</span>
                  </button>
                  <button
                    onClick={saveSeries}
                    className="flex items-center space-x-2 bg-brand text-white px-4 py-2 rounded-lg hover:bg-brand-600 transition-all shadow-sm hover:shadow active:scale-95"
                  >
                    <Save size={18} />
                    <span>Save Changes</span>
                  </button>
                  <button
                    onClick={handleUploadClick}
                    className="flex items-center space-x-2 bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 transition-all shadow-sm hover:shadow active:scale-95"
                    title="Upload to Firebase"
                  >
                    <CloudUpload size={18} />
                    <span>Upload to Firebase</span>
                  </button>
                </div>
              </div>

              <SeriesForm
                data={bibleSeries}
                onChange={setBibleSeries}
              />

              <div className="mt-8">
                <div className="flex justify-between items-end mb-4">
                  <h2 className="text-xl font-bold text-gray-800">Content Schedule</h2>
                  <button
                    onClick={handleAddNewContent}
                    className="flex items-center space-x-1 text-sm font-medium text-brand hover:bg-brand-50 px-3 py-1.5 rounded-md transition-colors"
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
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <div className="p-6 bg-white rounded-full mb-4 shadow-sm">
                <FileText size={48} className="text-gray-300" />
              </div>
              <h3 className="text-lg font-medium text-gray-600">No Series Selected</h3>
              <p className="text-sm">Select a file from the sidebar or create a new series.</p>
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
            nivData={nivData}
            onSelect={handleScriptureSelected}
            onCancel={() => setShowScripturePicker(false)}
          />
        )}

        {showUploadConfirm && (
          <ConfirmModal
            title="Confirm Upload"
            message="This data will be duplicated in Firebase if it already exists, would you like to proceed?"
            onConfirm={handleConfirmUpload}
            onCancel={() => setShowUploadConfirm(false)}
            confirmText="Proceed"
            isDangerous={false} // Orange warning feels appropriate for duplication, not destruction
          />
        )}
      </div>
    </div>
  );
}

export default BibleSeriesManager;
