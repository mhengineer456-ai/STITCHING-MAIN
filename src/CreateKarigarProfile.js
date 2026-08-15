// src/CreateKarigarProfile.js
import React, { useState, useRef, useEffect } from 'react';

export default function CreateKarigarProfile({ user, onNavigate, params }) {
  // State declarations
  const [formData, setFormData] = useState(() => {
    const savedData = localStorage.getItem('karigarFormData');
    if (savedData) {
      return JSON.parse(savedData);
    }
    return {
      karigarName: '',
      dateOfBirth: '',
      gender: '',
      floorArea: '',
      skillType: '',
      dateOfJoining: new Date().toISOString().split('T')[0],
      supervisorType: 'supervisor',
      supervisorName: '',
      mobileNumber: '',
      alternateNumber: '',
      emergencyContact: '',
    };
  });

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [activeSection, setActiveSection] = useState('personal');
  const [karigarId, setKarigarId] = useState('');
  const [profileImage, setProfileImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [formTouched, setFormTouched] = useState({});
  const [showSummary, setShowSummary] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [submittedImageUrl, setSubmittedImageUrl] = useState('');
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  
  const fileInputRef = useRef(null);

  // Google Apps Script Web App URL - Replace with your deployed URL
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzTxJcyrNdIWZhBMEnbrvd_99DVk3NxfbaZgAwaKaCLh0NUwu9Lm2Ux2Fmt2Tk0c141/exec';

  // Save to localStorage whenever formData changes
  useEffect(() => {
    localStorage.setItem('karigarFormData', JSON.stringify(formData));
  }, [formData]);

  // Generate Karigar ID
  useEffect(() => {
    generateKarigarId();
  }, [formData.supervisorName, formData.supervisorType, formData.karigarName, formData.mobileNumber]);

  // Load saved image
  useEffect(() => {
    const savedImage = localStorage.getItem('karigarImagePreview');
    if (savedImage) {
      setImagePreview(savedImage);
    }
  }, []);

const generateKarigarId = () => {
  const supervisorInitial = formData.supervisorName 
    ? formData.supervisorName.charAt(0).toUpperCase() 
    : 'X';
  
  const supervisorTypeCode = formData.supervisorType === 'supervisor' ? 'S' : 'T';
  const randomDigits = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  
  let nameInitials = 'XX';
  if (formData.karigarName) {
    const nameParts = formData.karigarName.trim().split(' ');
    if (nameParts.length >= 2) {
      nameInitials = (nameParts[0].charAt(0) + nameParts[nameParts.length - 1].charAt(0)).toUpperCase();
    } else {
      nameInitials = formData.karigarName.substring(0, 2).toUpperCase();
    }
  }
  
  const lastThreeMobile = formData.mobileNumber 
    ? formData.mobileNumber.slice(-3) 
    : '000';
  
  // Removed timestamp to restore original format (last 3 digits are mobile number)
  const newId = `${supervisorInitial}${supervisorTypeCode}${randomDigits}${nameInitials}${lastThreeMobile}`;
  setKarigarId(newId);
};

  // Test connection to Google Apps Script
  const testConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatus(null);
    
    try {
      const testPayload = {
        action: 'testConnection'
      };
      
      const formBody = new URLSearchParams();
      Object.keys(testPayload).forEach(key => {
        formBody.append(key, testPayload[key]);
      });
      
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString()
      });
      
      const result = await response.json();
      
      if (result.success) {
        setConnectionStatus({
          success: true,
          message: '✅ Connection successful! You can proceed with form submission.'
        });
      } else {
        setConnectionStatus({
          success: false,
          message: `❌ Connection failed: ${result.error || 'Unknown error'}`
        });
      }
    } catch (error) {
      console.error('Connection test error:', error);
      setConnectionStatus({
        success: false,
        message: '❌ Connection failed. Please check your Apps Script URL.'
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Function to compress image before upload
  const compressImage = (base64String, maxWidth = 800, maxHeight = 800, quality = 0.7) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64String;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Compress image
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
    });
  };

  // Function to submit data to Google Sheets
  const submitToGoogleSheets = async (submissionData) => {
    try {
      // Create URL-encoded string
      const formBody = new URLSearchParams();
      
      // IMPORTANT: Send as flat key-value pairs, not nested object
      // This matches what AppScript's e.parameter expects
      Object.keys(submissionData).forEach(key => {
        if (submissionData[key] !== null && submissionData[key] !== undefined) {
          formBody.append(key, submissionData[key]);
        }
      });
      
      console.log('Submitting to Google Sheets:', Object.fromEntries(formBody));
      
      // Submit to Google Apps Script
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString()
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || result.message || 'Failed to save to Google Sheets');
      }
      
      return result;
      
    } catch (error) {
      console.error('Error submitting to Google Sheets:', error);
      throw error;
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setFormTouched(prev => ({
      ...prev,
      [name]: true
    }));
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
    setApiError(null);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('File size should be less than 5MB');
        return;
      }
      
      if (!file.type.match('image.*')) {
        alert('Please upload an image file');
        return;
      }

      setProfileImage(file);
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        // Compress image before storing
        const compressedImage = await compressImage(reader.result);
        setImagePreview(compressedImage);
        localStorage.setItem('karigarImagePreview', compressedImage);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setProfileImage(null);
    setImagePreview(null);
    localStorage.removeItem('karigarImagePreview');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const calculateAge = (dob) => {
    if (!dob) return 'N/A';
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const getSkillIcon = (skill) => {
    const icons = {
      'tailor': '✂️',
      'cutter': '📏',
      'embroidery': '🪡',
      'finishing': '✨',
      'quality': '✅',
      'multi': '🔄'
    };
    return icons[skill] || '👤';
  };

  const getSkillName = (skill) => {
    const skillMap = {
      'tailor': 'Tailor',
      'cutter': 'Cutter',
      'embroidery': 'Embroidery Specialist',
      'finishing': 'Finishing Expert',
      'quality': 'Quality Checker',
      'multi': 'Multi-Skilled'
    };
    return skillMap[skill] || skill;
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.karigarName.trim()) {
      newErrors.karigarName = 'Karigar name is required';
    }
    if (!formData.dateOfBirth) {
      newErrors.dateOfBirth = 'Date of birth is required';
    }
    if (!formData.supervisorName.trim()) {
      newErrors.supervisorName = 'Supervisor/Thekedar name is required';
    }
    if (!formData.mobileNumber.trim()) {
      newErrors.mobileNumber = 'Mobile number is required';
    } else if (!/^[0-9]{10}$/.test(formData.mobileNumber)) {
      newErrors.mobileNumber = 'Please enter a valid 10-digit mobile number';
    }
    if (!formData.floorArea.trim()) {
      newErrors.floorArea = 'Floor area is required';
    }
    if (!formData.skillType) {
      newErrors.skillType = 'Please select a skill type';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleReview = (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      const firstError = Object.keys(errors)[0];
      const element = document.getElementById(firstError);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setShowReviewModal(true);
  };

  const handleConfirmSubmit = async () => {
    setShowReviewModal(false);
    setIsSubmitting(true);
    setApiError(null);
    
    try {
      // Get image name from file if available
      let imageName = '';
      if (profileImage) {
        imageName = profileImage.name;
      } else {
        imageName = `profile-${karigarId}.jpg`;
      }
      
      // Prepare submission data - FLAT structure, no nesting
      const submissionData = {
        // Add action for the AppScript
        action: 'createKarigar',
        
        // Karigar ID
        karigarId: karigarId,
        
        // Personal Information
        karigarName: formData.karigarName || '',
        dateOfBirth: formData.dateOfBirth || '',
        gender: formData.gender || '',
        
        // Professional Information
        floorArea: formData.floorArea || '',
        skillType: formData.skillType || '',
        dateOfJoining: formData.dateOfJoining || '',
        supervisorType: formData.supervisorType || '',
        supervisorName: formData.supervisorName || '',
        
        // Contact Information
        mobileNumber: formData.mobileNumber || '',
        alternateNumber: formData.alternateNumber || '',
        emergencyContact: formData.emergencyContact || '',
        
        // Image data
        profileImage: imagePreview || '',
        imageName: imageName,
        
        // Metadata
        registeredBy: user?.name || 'Admin',
        registrationDate: new Date().toISOString(),
        age: calculateAge(formData.dateOfBirth).toString(),
      };
      
      console.log('Submitting to Google Sheets:', submissionData);
      
      // Submit to Google Sheets
      const result = await submitToGoogleSheets(submissionData);
      
      console.log('Google Sheets response:', result);
      
      // Store the image URL from response
      if (result.imageUrl) {
        setSubmittedImageUrl(result.imageUrl);
      }
      
      // Show success message
      setSubmitSuccess(true);
      
      // Clear form after success
      setTimeout(() => {
        localStorage.removeItem('karigarFormData');
        localStorage.removeItem('karigarImagePreview');
        setSubmitSuccess(false);
        setFormData({
          karigarName: '',
          dateOfBirth: '',
          gender: '',
          floorArea: '',
          skillType: '',
          dateOfJoining: new Date().toISOString().split('T')[0],
          supervisorType: 'supervisor',
          supervisorName: '',
          mobileNumber: '',
          alternateNumber: '',
          emergencyContact: '',
        });
        setProfileImage(null);
        setImagePreview(null);
        setSubmittedImageUrl('');
        setActiveSection('personal');
        setFormTouched({});
        setShowSummary(false);
      }, 5000);
      
    } catch (error) {
      console.error('Error submitting form:', error);
      setApiError(error.message || 'Failed to save to Google Sheets. Please try again.');
      
      setTimeout(() => {
        setShowReviewModal(true);
      }, 1000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Are you sure you want to cancel? All unsaved data will be lost.')) {
      localStorage.removeItem('karigarFormData');
      localStorage.removeItem('karigarImagePreview');
      if (onNavigate) {
        onNavigate('Welcome', user);
      }
    }
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset the form? All entered data will be cleared.')) {
      localStorage.removeItem('karigarFormData');
      localStorage.removeItem('karigarImagePreview');
      setFormData({
        karigarName: '',
        dateOfBirth: '',
        gender: '',
        floorArea: '',
        skillType: '',
        dateOfJoining: new Date().toISOString().split('T')[0],
        supervisorType: 'supervisor',
        supervisorName: '',
        mobileNumber: '',
        alternateNumber: '',
        emergencyContact: '',
      });
      setProfileImage(null);
      setImagePreview(null);
      setFormTouched({});
      setShowSummary(false);
    }
  };

  const sections = [
    { id: 'personal', label: 'Personal Info', icon: '👤' },
    { id: 'professional', label: 'Professional', icon: '💼' },
    { id: 'contact', label: 'Contact', icon: '📱' },
    { id: 'summary', label: 'Summary View', icon: '📊' },
  ];

  // Success Modal with Image URL
  const SuccessModal = () => (
    <div style={styles.modalOverlay}>
      <div style={styles.modalContent}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Profile Created Successfully!</h2>
          <button 
            onClick={() => setSubmitSuccess(false)} 
            style={styles.modalCloseButton}
          >
            ×
          </button>
        </div>
        
        <div style={styles.modalBody}>
          <div style={styles.successIconLarge}>✅</div>
          
          <div style={styles.successDetails}>
            <h3 style={styles.successKarigarId}>Karigar ID: {karigarId}</h3>
            
            {submittedImageUrl && (
              <div style={styles.imageUrlContainer}>
                <h4 style={styles.imageUrlTitle}>Profile Image URL:</h4>
                <div style={styles.imageUrlBox}>
                  <input 
                    type="text" 
                    value={submittedImageUrl} 
                    readOnly 
                    style={styles.imageUrlInput}
                  />
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(submittedImageUrl);
                      alert('URL copied to clipboard!');
                    }}
                    style={styles.copyButton}
                  >
                    📋 Copy
                  </button>
                </div>
                <p style={styles.imageUrlNote}>
                  This URL is stored in Google Sheets and is publicly accessible.
                </p>
                <div style={styles.imagePreviewContainer}>
                  <img 
                    src={submittedImageUrl} 
                    alt="Profile" 
                    style={styles.successImagePreview}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
              </div>
            )}
            
            <div style={styles.successActions}>
              <button 
                onClick={() => {
                  setSubmitSuccess(false);
                  if (onNavigate) {
                    onNavigate('Welcome', user);
                  }
                }}
                style={styles.successButton}
              >
                Go to Dashboard
              </button>
              <button 
                onClick={() => {
                  setSubmitSuccess(false);
                  window.location.reload();
                }}
                style={styles.successSecondaryButton}
              >
                Create Another Profile
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Review Modal Component
  const ReviewModal = () => (
    <div style={styles.modalOverlay}>
      <div style={styles.modalContent}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Review Karigar Profile</h2>
          <button 
            onClick={() => setShowReviewModal(false)} 
            style={styles.modalCloseButton}
          >
            ×
          </button>
        </div>
        
        <div style={styles.modalBody}>
          {apiError && (
            <div style={styles.apiError}>
              <span style={styles.errorIcon}>⚠️</span>
              <span>{apiError}</span>
            </div>
          )}
          
          {/* Profile Header */}
          <div style={styles.reviewHeader}>
            <div style={styles.reviewProfileImage}>
              {imagePreview ? (
                <img src={imagePreview} alt="Profile" style={styles.reviewImage} />
              ) : (
                <div style={styles.reviewImagePlaceholder}>
                  {formData.karigarName ? formData.karigarName.charAt(0).toUpperCase() : '👤'}
                </div>
              )}
            </div>
            <div style={styles.reviewHeaderInfo}>
              <h3 style={styles.reviewName}>{formData.karigarName || 'New Karigar'}</h3>
              <div style={styles.reviewBadge}>
                <span style={styles.reviewId}>ID: {karigarId || '---'}</span>
              </div>
            </div>
          </div>

          {/* Summary Grid */}
          <div style={styles.reviewGrid}>
            {/* Personal Details */}
            <div style={styles.reviewSection}>
              <h4 style={styles.reviewSectionTitle}>👤 Personal Details</h4>
              <div style={styles.reviewDetails}>
                <div style={styles.reviewRow}>
                  <span>Date of Birth:</span>
                  <strong>{formData.dateOfBirth ? new Date(formData.dateOfBirth).toLocaleDateString() : '—'}</strong>
                </div>
                <div style={styles.reviewRow}>
                  <span>Gender:</span>
                  <strong>{formData.gender ? formData.gender.charAt(0).toUpperCase() + formData.gender.slice(1) : '—'}</strong>
                </div>
                <div style={styles.reviewRow}>
                  <span>Age:</span>
                  <strong>{formData.dateOfBirth ? calculateAge(formData.dateOfBirth) + ' years' : '—'}</strong>
                </div>
              </div>
            </div>

            {/* Professional Details */}
            <div style={styles.reviewSection}>
              <h4 style={styles.reviewSectionTitle}>💼 Professional Details</h4>
              <div style={styles.reviewDetails}>
                <div style={styles.reviewRow}>
                  <span>Floor Area:</span>
                  <strong>{formData.floorArea || '—'}</strong>
                </div>
                <div style={styles.reviewRow}>
                  <span>Skill Type:</span>
                  <strong>
                    {formData.skillType ? (
                      <span>{getSkillIcon(formData.skillType)} {getSkillName(formData.skillType)}</span>
                    ) : '—'}
                  </strong>
                </div>
                <div style={styles.reviewRow}>
                  <span>Date of Joining:</span>
                  <strong>{formData.dateOfJoining ? new Date(formData.dateOfJoining).toLocaleDateString() : '—'}</strong>
                </div>
                <div style={styles.reviewRow}>
                  <span>Supervisor:</span>
                  <strong>
                    {formData.supervisorType === 'supervisor' ? '👨‍💼 ' : '👨‍🌾 '}
                    {formData.supervisorName || '—'}
                  </strong>
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div style={styles.reviewSection}>
              <h4 style={styles.reviewSectionTitle}>📱 Contact Information</h4>
              <div style={styles.reviewDetails}>
                <div style={styles.reviewRow}>
                  <span>Mobile:</span>
                  <strong>{formData.mobileNumber || '—'}</strong>
                </div>
                <div style={styles.reviewRow}>
                  <span>Alternate:</span>
                  <strong>{formData.alternateNumber || '—'}</strong>
                </div>
                <div style={styles.reviewRow}>
                  <span>Emergency:</span>
                  <strong>{formData.emergencyContact || '—'}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Registration Info */}
          <div style={styles.reviewFooter}>
            <div style={styles.reviewInfo}>
              <span>📅 Registered by: {user?.name || 'Admin'}</span>
              <span>🆔 {karigarId}</span>
            </div>
          </div>
        </div>

        <div style={styles.modalFooter}>
          <button 
            onClick={() => setShowReviewModal(false)} 
            style={styles.modalCancelButton}
          >
            Back to Edit
          </button>
          <button 
            onClick={handleConfirmSubmit} 
            style={styles.modalConfirmButton}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span style={styles.spinner}></span>
                Creating...
              </>
            ) : (
              'Confirm & Create Profile'
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // Summary View Component
  const SummaryView = () => (
    <div style={styles.summaryContainer}>
      <div style={styles.summaryHeader}>
        <div style={styles.summaryProfileImage}>
          {imagePreview ? (
            <img src={imagePreview} alt="Profile" style={styles.summaryImage} />
          ) : (
            <div style={styles.summaryImagePlaceholder}>
              {formData.karigarName ? formData.karigarName.charAt(0).toUpperCase() : '👤'}
            </div>
          )}
        </div>
        <div style={styles.summaryHeaderInfo}>
          <h2 style={styles.summaryName}>{formData.karigarName || 'New Karigar'}</h2>
          <div style={styles.summaryBadge}>
            <span style={styles.summaryId}>ID: {karigarId || '---'}</span>
            <span style={styles.summaryStatus}>Active</span>
          </div>
          <div style={styles.summaryMeta}>
            <span>📅 Registered: {new Date().toLocaleDateString()}</span>
            <span>👤 Registered by: {user?.name || 'Admin'}</span>
          </div>
        </div>
      </div>

      <div style={styles.metricsGrid}>
        <div style={styles.metricCard}>
          <div style={styles.metricIcon}>📱</div>
          <div style={styles.metricContent}>
            <span style={styles.metricLabel}>Contact</span>
            <span style={styles.metricValue}>
              {formData.mobileNumber || 'Not provided'}
            </span>
          </div>
        </div>
        <div style={styles.metricCard}>
          <div style={styles.metricIcon}>🎂</div>
          <div style={styles.metricContent}>
            <span style={styles.metricLabel}>Age</span>
            <span style={styles.metricValue}>
              {formData.dateOfBirth ? `${calculateAge(formData.dateOfBirth)} years` : 'N/A'}
            </span>
          </div>
        </div>
        <div style={styles.metricCard}>
          <div style={styles.metricIcon}>💼</div>
          <div style={styles.metricContent}>
            <span style={styles.metricLabel}>Skill</span>
            <span style={styles.metricValue}>
              {formData.skillType ? getSkillName(formData.skillType) : 'Not specified'}
            </span>
          </div>
        </div>
        <div style={styles.metricCard}>
          <div style={styles.metricIcon}>📍</div>
          <div style={styles.metricContent}>
            <span style={styles.metricLabel}>Floor Area</span>
            <span style={styles.metricValue}>
              {formData.floorArea || 'Not assigned'}
            </span>
          </div>
        </div>
      </div>

      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryCardHeader}>
            <span style={styles.summaryCardIcon}>👤</span>
            <h3 style={styles.summaryCardTitle}>Personal Details</h3>
          </div>
          <div style={styles.summaryCardContent}>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Full Name</span>
              <span style={styles.summaryValue}>{formData.karigarName || '—'}</span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Date of Birth</span>
              <span style={styles.summaryValue}>
                {formData.dateOfBirth ? new Date(formData.dateOfBirth).toLocaleDateString() : '—'}
              </span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Gender</span>
              <span style={styles.summaryValue}>{formData.gender ? formData.gender.charAt(0).toUpperCase() + formData.gender.slice(1) : '—'}</span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Age</span>
              <span style={styles.summaryValue}>{formData.dateOfBirth ? calculateAge(formData.dateOfBirth) + ' years' : '—'}</span>
            </div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryCardHeader}>
            <span style={styles.summaryCardIcon}>💼</span>
            <h3 style={styles.summaryCardTitle}>Professional Details</h3>
          </div>
          <div style={styles.summaryCardContent}>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Floor Area</span>
              <span style={styles.summaryValue}>{formData.floorArea || '—'}</span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Skill Type</span>
              <span style={styles.summaryValue}>
                {formData.skillType ? (
                  <span>
                    {getSkillIcon(formData.skillType)} {getSkillName(formData.skillType)}
                  </span>
                ) : '—'}
              </span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Date of Joining</span>
              <span style={styles.summaryValue}>
                {formData.dateOfJoining ? new Date(formData.dateOfJoining).toLocaleDateString() : '—'}
              </span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Supervisor Type</span>
              <span style={styles.summaryValue}>
                {formData.supervisorType === 'supervisor' ? '👨‍💼 Supervisor' : '👨‍🌾 Thekedar'}
              </span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Supervisor Name</span>
              <span style={styles.summaryValue}>{formData.supervisorName || '—'}</span>
            </div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryCardHeader}>
            <span style={styles.summaryCardIcon}>📱</span>
            <h3 style={styles.summaryCardTitle}>Contact Information</h3>
          </div>
          <div style={styles.summaryCardContent}>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Mobile Number</span>
              <span style={styles.summaryValue}>
                {formData.mobileNumber ? (
                  <span style={styles.contactValue}>
                    📞 {formData.mobileNumber}
                    {formData.mobileNumber && <span style={styles.verifiedBadge}>✓</span>}
                  </span>
                ) : '—'}
              </span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Alternate Number</span>
              <span style={styles.summaryValue}>{formData.alternateNumber || '—'}</span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Emergency Contact</span>
              <span style={styles.summaryValue}>{formData.emergencyContact || '—'}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={styles.additionalInfo}>
        <div style={styles.infoChip}>
          <span>📅 Profile created on {new Date().toLocaleDateString()}</span>
        </div>
        <div style={styles.infoChip}>
          <span>🆔 {karigarId}</span>
        </div>
        <div style={styles.infoChip}>
          <span>📊 Status: Active</span>
        </div>
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button onClick={handleCancel} style={styles.backButton}>
            ← Dashboard
          </button>
        </div>
        
        <div style={styles.headerCenter}>
          <h1 style={styles.title}>Create Karigar Profile</h1>
          <p style={styles.subtitle}>Register a new artisan in the system</p>
        </div>

        <div style={styles.headerRight}>
          <div style={styles.idCard}>
            <span style={styles.idLabel}>Karigar ID</span>
            <span style={styles.idValue}>{karigarId || '---'}</span>
          </div>
        </div>
      </div>

      {/* Connection Test Button */}
      <div style={styles.testConnectionContainer}>
        <button 
          onClick={testConnection} 
          style={styles.testConnectionButton}
          disabled={isTestingConnection}
        >
          {isTestingConnection ? 'Testing...' : '🔌 Test Connection'}
        </button>
        {connectionStatus && (
          <div style={{
            ...styles.connectionStatus,
            ...(connectionStatus.success ? styles.connectionSuccess : styles.connectionError)
          }}>
            {connectionStatus.message}
          </div>
        )}
      </div>

      {/* Success Modal */}
      {submitSuccess && <SuccessModal />}

      {/* API Error Message */}
      {apiError && !showReviewModal && !submitSuccess && (
        <div style={styles.apiErrorMessage}>
          <div style={styles.errorIcon}>⚠️</div>
          <div style={styles.errorContent}>
            <strong>Error saving to Google Sheets</strong>
            <span>{apiError}</span>
          </div>
          <button 
            onClick={() => setApiError(null)} 
            style={styles.errorCloseButton}
          >
            ×
          </button>
        </div>
      )}

      {/* Review Modal */}
      {showReviewModal && <ReviewModal />}

      {/* Main Layout */}
      <div style={styles.mainLayout}>
        {/* Left Sidebar - Profile Summary */}
        <div style={styles.sidebar}>
          <div style={styles.profileCard}>
            <div style={styles.profileImageContainer}>
              {imagePreview ? (
                <div style={styles.imagePreviewWrapper}>
                  <img src={imagePreview} alt="Profile" style={styles.profileImage} />
                  <button onClick={handleRemoveImage} style={styles.removeImageBtn} title="Remove image">
                    ×
                  </button>
                </div>
              ) : (
                <div 
                  style={styles.imagePlaceholder}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span style={styles.uploadIcon}>📸</span>
                  <span style={styles.uploadText}>Upload Photo</span>
                </div>
              )}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageUpload}
                accept="image/*"
                style={{ display: 'none' }}
              />
            </div>
            
            <div style={styles.profileInfo}>
              <h3 style={styles.profileName}>
                {formData.karigarName || 'New Karigar'}
              </h3>
              <p style={styles.profileId}>{karigarId}</p>
              
              <div style={styles.profileStats}>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Mobile</span>
                  <span style={styles.statValue}>
                    {formData.mobileNumber || 'Not added'}
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Skill</span>
                  <span style={styles.statValue}>
                    {formData.skillType ? (
                      <span>{getSkillIcon(formData.skillType)} {formData.skillType}</span>
                    ) : 'Not selected'}
                  </span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>Supervisor</span>
                  <span style={styles.statValue}>
                    {formData.supervisorName || 'Not assigned'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Menu */}
          <div style={styles.navMenu}>
            {sections.map(section => (
              <button
                key={section.id}
                onClick={() => {
                  setActiveSection(section.id);
                  setShowSummary(section.id === 'summary');
                }}
                style={{
                  ...styles.navItem,
                  ...(activeSection === section.id ? styles.navItemActive : {})
                }}
              >
                <span style={styles.navIcon}>{section.icon}</span>
                <span style={styles.navLabel}>{section.label}</span>
              </button>
            ))}
          </div>

          {/* Quick Actions */}
          <div style={styles.quickActions}>
            <button onClick={handleReset} style={styles.resetButton}>
              ↻ Reset Form
            </button>
          </div>
        </div>

        {/* Right Content - Form Sections or Summary */}
        <div style={styles.contentArea}>
          {showSummary ? (
            <SummaryView />
          ) : (
            <form onSubmit={handleReview} style={styles.form}>
              {/* Personal Information Section */}
              {activeSection === 'personal' && (
                <div style={styles.section}>
                  <h2 style={styles.sectionTitle}>Personal Information</h2>
                  <p style={styles.sectionSubtitle}>Basic details about the karigar</p>
                  
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        Full Name <span style={styles.required}>*</span>
                      </label>
                      <input
                        id="karigarName"
                        type="text"
                        name="karigarName"
                        value={formData.karigarName}
                        onChange={handleChange}
                        placeholder="Enter full name"
                        style={{
                          ...styles.input,
                          ...(errors.karigarName && formTouched.karigarName ? styles.inputError : {})
                        }}
                      />
                      {errors.karigarName && formTouched.karigarName && (
                        <span style={styles.errorText}>{errors.karigarName}</span>
                      )}
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        Date of Birth <span style={styles.required}>*</span>
                      </label>
                      <input
                        id="dateOfBirth"
                        type="date"
                        name="dateOfBirth"
                        value={formData.dateOfBirth}
                        onChange={handleChange}
                        style={{
                          ...styles.input,
                          ...(errors.dateOfBirth && formTouched.dateOfBirth ? styles.inputError : {})
                        }}
                      />
                      {errors.dateOfBirth && formTouched.dateOfBirth && (
                        <span style={styles.errorText}>{errors.dateOfBirth}</span>
                      )}
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Gender</label>
                      <select
                        name="gender"
                        value={formData.gender}
                        onChange={handleChange}
                        style={styles.select}
                      >
                        <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Professional Information Section */}
              {activeSection === 'professional' && (
                <div style={styles.section}>
                  <h2 style={styles.sectionTitle}>Professional Details</h2>
                  <p style={styles.sectionSubtitle}>Work and supervisor information</p>

                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        Floor Area <span style={styles.required}>*</span>
                      </label>
                      <input
                        id="floorArea"
                        type="text"
                        name="floorArea"
                        value={formData.floorArea}
                        onChange={handleChange}
                        placeholder="e.g., Floor 3, Section A"
                        style={{
                          ...styles.input,
                          ...(errors.floorArea && formTouched.floorArea ? styles.inputError : {})
                        }}
                      />
                      {errors.floorArea && formTouched.floorArea && (
                        <span style={styles.errorText}>{errors.floorArea}</span>
                      )}
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        Skill Type <span style={styles.required}>*</span>
                      </label>
                      <select
                        id="skillType"
                        name="skillType"
                        value={formData.skillType}
                        onChange={handleChange}
                        style={{
                          ...styles.select,
                          ...(errors.skillType && formTouched.skillType ? styles.inputError : {})
                        }}
                      >
                        <option value="">Select skill</option>
                        <option value="tailor">✂️ Tailor</option>
                        <option value="cutter">📏 Cutter</option>
                        <option value="embroidery">🪡 Embroidery Specialist</option>
                        <option value="finishing">✨ Finishing Expert</option>
                        <option value="quality">✅ Quality Checker</option>
                        <option value="multi">🔄 Multi-Skilled</option>
                      </select>
                      {errors.skillType && formTouched.skillType && (
                        <span style={styles.errorText}>{errors.skillType}</span>
                      )}
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Date of Joining</label>
                      <input
                        type="date"
                        name="dateOfJoining"
                        value={formData.dateOfJoining}
                        onChange={handleChange}
                        style={styles.input}
                      />
                    </div>
                  </div>

                  <div style={styles.sectionDivider}></div>

                  <h3 style={styles.subsectionTitle}>Supervisor Assignment</h3>
                  
                  <div style={styles.supervisorToggle}>
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, supervisorType: 'supervisor'})}
                      style={{
                        ...styles.toggleButton,
                        ...(formData.supervisorType === 'supervisor' ? styles.toggleButtonActive : {})
                      }}
                    >
                      👨‍💼 Supervisor
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, supervisorType: 'thekedar'})}
                      style={{
                        ...styles.toggleButton,
                        ...(formData.supervisorType === 'thekedar' ? styles.toggleButtonActive : {})
                      }}
                    >
                      👨‍🌾 Thekedar
                    </button>
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>
                      {formData.supervisorType === 'supervisor' ? 'Supervisor' : 'Thekedar'} Name <span style={styles.required}>*</span>
                    </label>
                    <input
                      id="supervisorName"
                      type="text"
                      name="supervisorName"
                      value={formData.supervisorName}
                      onChange={handleChange}
                      placeholder={`Enter ${formData.supervisorType} name`}
                      style={{
                        ...styles.input,
                        ...(errors.supervisorName && formTouched.supervisorName ? styles.inputError : {})
                      }}
                    />
                    {errors.supervisorName && formTouched.supervisorName && (
                      <span style={styles.errorText}>{errors.supervisorName}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Contact Information Section */}
              {activeSection === 'contact' && (
                <div style={styles.section}>
                  <h2 style={styles.sectionTitle}>Contact Information</h2>
                  <p style={styles.sectionSubtitle}>Phone numbers for communication</p>

                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        Mobile Number <span style={styles.required}>*</span>
                      </label>
                      <input
                        id="mobileNumber"
                        type="tel"
                        name="mobileNumber"
                        value={formData.mobileNumber}
                        onChange={handleChange}
                        placeholder="10-digit mobile number"
                        maxLength="10"
                        style={{
                          ...styles.input,
                          ...(errors.mobileNumber && formTouched.mobileNumber ? styles.inputError : {})
                        }}
                      />
                      {errors.mobileNumber && formTouched.mobileNumber && (
                        <span style={styles.errorText}>{errors.mobileNumber}</span>
                      )}
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Alternate Number</label>
                      <input
                        type="tel"
                        name="alternateNumber"
                        value={formData.alternateNumber}
                        onChange={handleChange}
                        placeholder="Alternate contact (optional)"
                        maxLength="10"
                        style={styles.input}
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Emergency Contact</label>
                      <input
                        type="tel"
                        name="emergencyContact"
                        value={formData.emergencyContact}
                        onChange={handleChange}
                        placeholder="Emergency contact number"
                        maxLength="10"
                        style={styles.input}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Form Actions */}
              <div style={styles.formActions}>
                <button type="button" onClick={handleCancel} style={styles.cancelButton}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    ...styles.submitButton,
                    ...(isSubmitting ? styles.submitButtonDisabled : {})
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <span style={styles.spinner}></span>
                      Creating...
                    </>
                  ) : (
                    'Review & Create Profile'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Styles object (keeping your existing styles)
const styles = {
  container: {
    minHeight: '100vh',
    background: '#ffffff',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    padding: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 16,
    background: 'white',
    padding: '16px 28px',
    borderRadius: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
  },
  headerLeft: {
    flex: 1,
  },
  headerCenter: {
    flex: 2,
    textAlign: 'center',
  },
  headerRight: {
    flex: 1,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  backButton: {
    padding: '8px 16px',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    color: '#475569',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#0037b6',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    margin: '4px 0 0 0',
  },
  idCard: {
    background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
    padding: '8px 16px',
    borderRadius: 8,
    textAlign: 'right',
  },
  idLabel: {
    display: 'block',
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
  },
  idValue: {
    display: 'block',
    fontSize: 16,
    fontWeight: 600,
    color: 'white',
    letterSpacing: '0.5px',
  },
  testConnectionContainer: {
    marginBottom: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  testConnectionButton: {
    padding: '8px 16px',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    color: '#475569',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  connectionStatus: {
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 14,
  },
  connectionSuccess: {
    background: '#f0fdf4',
    color: '#166534',
    border: '1px solid #86efac',
  },
  connectionError: {
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
  },
  successMessage: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    background: '#f0fdf4',
    border: '1px solid #86efac',
    borderRadius: 12,
    padding: '16px 24px',
    marginBottom: 24,
    color: '#166534',
  },
  successIcon: {
    fontSize: 24,
  },
  successContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  mainLayout: {
    display: 'grid',
    gridTemplateColumns: '320px 1fr',
    gap: 24,
  },
  sidebar: {
    background: 'white',
    borderRadius: 16,
    padding: '24px 16px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    height: 'fit-content',
  },
  profileCard: {
    marginBottom: 24,
    padding: 16,
    background: '#f8fafc',
    borderRadius: 12,
    textAlign: 'center',
  },
  profileImageContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 16,
  },
  imagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: '50%',
    background: '#f1f5f9',
    border: '2px dashed #cbd5e1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  imagePreviewWrapper: {
    position: 'relative',
    width: 120,
    height: 120,
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '3px solid white',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
  removeImageBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: '#ef4444',
    border: 'none',
    color: 'white',
    fontSize: 18,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
  },
  uploadIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  uploadText: {
    fontSize: 12,
    color: '#64748b',
  },
  profileInfo: {
    textAlign: 'center',
  },
  profileName: {
    fontSize: 18,
    fontWeight: 600,
    color: '#0f172a',
    margin: '0 0 4px 0',
  },
  profileId: {
    fontSize: 13,
    color: '#64748b',
    margin: '0 0 12px 0',
    fontFamily: 'monospace',
  },
  profileStats: {
    textAlign: 'left',
    borderTop: '1px solid #e2e8f0',
    paddingTop: 12,
  },
  statItem: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 8,
    fontSize: 13,
  },
  statLabel: {
    color: '#64748b',
  },
  statValue: {
    color: '#0f172a',
    fontWeight: 500,
  },
  navMenu: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 24,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    color: '#475569',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    width: '100%',
    textAlign: 'left',
  },
  navItemActive: {
    background: '#eff6ff',
    color: '#2563eb',
  },
  navIcon: {
    fontSize: 18,
  },
  navLabel: {
    flex: 1,
  },
  quickActions: {
    borderTop: '1px solid #e2e8f0',
    paddingTop: 16,
  },
  resetButton: {
    width: '100%',
    padding: '10px',
    background: '#fef2f2',
    border: '1px solid #fee2e2',
    borderRadius: 8,
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  contentArea: {
    background: 'white',
    borderRadius: 16,
    padding: '32px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
  },
  form: {
    width: '100%',
  },
  section: {
    animation: 'fadeIn 0.3s ease',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: '#0f172a',
    margin: '0 0 4px 0',
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#64748b',
    margin: '0 0 24px 0',
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
    margin: '0 0 16px 0',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 20,
    marginBottom: 24,
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
  },
  required: {
    color: '#dc2626',
    marginLeft: 2,
  },
  input: {
    width: '100%',
    height: 42,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    padding: '0 12px',
    fontSize: 14,
    background: '#ffffff',
    color: '#0f172a',
    transition: 'all 0.2s ease',
  },
  inputError: {
    border: '1px solid #dc2626',
    background: '#fef2f2',
  },
  select: {
    width: '100%',
    height: 42,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    padding: '0 12px',
    fontSize: 14,
    background: '#ffffff',
    color: '#0f172a',
    cursor: 'pointer',
  },
  errorText: {
    fontSize: 11,
    color: '#dc2626',
    marginTop: 2,
  },
  sectionDivider: {
    height: 1,
    background: '#e2e8f0',
    margin: '24px 0',
  },
  supervisorToggle: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 12,
    marginBottom: 20,
  },
  toggleButton: {
    padding: '12px',
    background: '#f8fafc',
    border: '2px solid #e2e8f0',
    borderRadius: 8,
    color: '#475569',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  toggleButtonActive: {
    borderColor: '#2563eb',
    background: '#eff6ff',
    color: '#2563eb',
  },
  formActions: {
    display: 'flex',
    gap: 12,
    marginTop: 32,
    paddingTop: 24,
    borderTop: '1px solid #e2e8f0',
  },
  cancelButton: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: 'white',
    color: '#64748b',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  submitButton: {
    flex: 2,
    height: 44,
    borderRadius: 8,
    border: 'none',
    background: '#2563eb',
    color: 'white',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  submitButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  spinner: {
    width: 16,
    height: 16,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: 'white',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    display: 'inline-block',
    marginRight: 8,
  },
  // Modal Styles
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    animation: 'fadeIn 0.2s ease',
  },
  modalContent: {
    background: 'white',
    borderRadius: 16,
    width: '90%',
    maxWidth: 800,
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #e2e8f0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: '#0f172a',
    margin: 0,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: 'none',
    background: '#f1f5f9',
    color: '#64748b',
    fontSize: 20,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
  modalBody: {
    padding: '24px',
  },
  modalFooter: {
    display: 'flex',
    gap: 12,
    padding: '20px 24px',
    borderTop: '1px solid #e2e8f0',
    background: '#f8fafc',
  },
  modalCancelButton: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: 'white',
    color: '#64748b',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  modalConfirmButton: {
    flex: 2,
    height: 44,
    borderRadius: 8,
    border: 'none',
    background: '#2563eb',
    color: 'white',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  // Review Modal Styles
  reviewHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '16px',
    background: '#f8fafc',
    borderRadius: 12,
    marginBottom: 24,
  },
  reviewProfileImage: {
    width: 70,
    height: 70,
    borderRadius: '50%',
    overflow: 'hidden',
    border: '3px solid white',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
  reviewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  reviewImagePlaceholder: {
    width: '100%',
    height: '100%',
    background: '#e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 600,
    color: '#64748b',
  },
  reviewHeaderInfo: {
    flex: 1,
  },
  reviewName: {
    fontSize: 20,
    fontWeight: 600,
    color: '#0f172a',
    margin: '0 0 4px 0',
  },
  reviewBadge: {
    display: 'flex',
    gap: 8,
  },
  reviewId: {
    padding: '2px 8px',
    background: '#e2e8f0',
    borderRadius: 12,
    fontSize: 11,
    color: '#475569',
  },
  reviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 16,
    marginBottom: 20,
  },
  reviewSection: {
    background: '#f8fafc',
    borderRadius: 12,
    padding: 16,
  },
  reviewSectionTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#0f172a',
    margin: '0 0 12px 0',
    paddingBottom: 8,
    borderBottom: '1px solid #e2e8f0',
  },
  reviewDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  reviewRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
  },
  reviewFooter: {
    padding: '12px 16px',
    background: '#f1f5f9',
    borderRadius: 8,
  },
  reviewInfo: {
    display: 'flex',
    gap: 16,
    fontSize: 12,
    color: '#475569',
  },
  // Summary View Styles
  summaryContainer: {
    animation: 'fadeIn 0.3s ease',
  },
  summaryHeader: {
    display: 'flex',
    gap: 24,
    padding: 24,
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderRadius: 16,
    marginBottom: 24,
    color: 'white',
  },
  summaryProfileImage: {
    width: 100,
    height: 100,
    borderRadius: '50%',
    overflow: 'hidden',
    border: '3px solid white',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  },
  summaryImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  summaryImagePlaceholder: {
    width: '100%',
    height: '100%',
    background: 'rgba(255,255,255,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 40,
    fontWeight: 600,
  },
  summaryHeaderInfo: {
    flex: 1,
  },
  summaryName: {
    fontSize: 28,
    fontWeight: 700,
    margin: '0 0 8px 0',
  },
  summaryBadge: {
    display: 'flex',
    gap: 12,
    marginBottom: 8,
  },
  summaryId: {
    padding: '4px 12px',
    background: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 500,
  },
  summaryStatus: {
    padding: '4px 12px',
    background: '#10b981',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 500,
  },
  summaryMeta: {
    display: 'flex',
    gap: 16,
    fontSize: 13,
    opacity: 0.9,
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
    marginBottom: 24,
  },
  metricCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    background: '#f8fafc',
    borderRadius: 12,
    border: '1px solid #e2e8f0',
  },
  metricIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: '#e0f2fe',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
  },
  metricContent: {
    display: 'flex',
    flexDirection: 'column',
  },
  metricLabel: {
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 16,
    marginBottom: 24,
  },
  summaryCard: {
    background: '#f8fafc',
    borderRadius: 12,
    padding: 16,
    border: '1px solid #e2e8f0',
  },
  summaryCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: '1px solid #e2e8f0',
  },
  summaryCardIcon: {
    fontSize: 20,
  },
  summaryCardTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
    margin: 0,
  },
  summaryCardContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
  },
  summaryLabel: {
    color: '#64748b',
    fontWeight: 500,
  },
  summaryValue: {
    color: '#0f172a',
    fontWeight: 500,
    textAlign: 'right',
    maxWidth: '60%',
  },
  contactValue: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#10b981',
    color: 'white',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
  },
  additionalInfo: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginTop: 24,
    padding: 16,
    background: '#f8fafc',
    borderRadius: 12,
  },
  infoChip: {
    padding: '6px 12px',
    background: 'white',
    borderRadius: 20,
    fontSize: 12,
    color: '#475569',
    border: '1px solid #e2e8f0',
  },
  // Success Modal Styles
  successIconLarge: {
    fontSize: 64,
    textAlign: 'center',
    marginBottom: 24,
  },
  successDetails: {
    textAlign: 'center',
  },
  successKarigarId: {
    fontSize: 20,
    color: '#0f172a',
    marginBottom: 20,
    fontWeight: 600,
  },
  imageUrlContainer: {
    background: '#f8fafc',
    borderRadius: 12,
    padding: 20,
    margin: '20px 0',
    border: '1px solid #e2e8f0',
  },
  imageUrlTitle: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 10,
    textAlign: 'left',
  },
  imageUrlBox: {
    display: 'flex',
    gap: 8,
    marginBottom: 10,
  },
  imageUrlInput: {
    flex: 1,
    height: 42,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '0 12px',
    fontSize: 13,
    background: 'white',
    color: '#0f172a',
  },
  copyButton: {
    height: 42,
    padding: '0 16px',
    background: '#2563eb',
    border: 'none',
    borderRadius: 8,
    color: 'white',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  imageUrlNote: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'left',
    marginTop: 8,
  },
  imagePreviewContainer: {
    marginTop: 16,
    textAlign: 'center',
  },
  successImagePreview: {
    maxWidth: '100%',
    maxHeight: 200,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
  },
  successActions: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginTop: 24,
  },
  successButton: {
    padding: '12px 24px',
    background: '#2563eb',
    border: 'none',
    borderRadius: 8,
    color: 'white',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  successSecondaryButton: {
    padding: '12px 24px',
    background: 'white',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    color: '#475569',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  apiError: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    marginBottom: 20,
    color: '#991b1b',
  },
  apiErrorMessage: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 12,
    padding: '16px 24px',
    marginBottom: 24,
    color: '#991b1b',
    position: 'relative',
  },
  errorIcon: {
    fontSize: 20,
  },
  errorContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  errorCloseButton: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0,0,0,0.05)',
    color: '#991b1b',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
};

// CSS string
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: #2563eb !important;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1) !important;
}

.backButton:hover {
  background: #e2e8f0 !important;
}

.testConnectionButton:hover {
  background: #e2e8f0 !important;
}

.resetButton:hover {
  background: #fee2e2 !important;
}

.cancelButton:hover {
  background: #f8fafc !important;
  border-color: #cbd5e1 !important;
}

.submitButton:hover:not(:disabled) {
  background: #1d4ed8 !important;
  transform: translateY(-1px);
  boxShadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.modalCancelButton:hover {
  background: #f1f5f9 !important;
}

.modalConfirmButton:hover:not(:disabled) {
  background: #1d4ed8 !important;
  transform: translateY(-1px);
  boxShadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.modalCloseButton:hover {
  background: #e2e8f0 !important;
}

.imagePlaceholder:hover {
  border-color: #2563eb;
  background: #f0f9ff;
}

.navItem:hover {
  background: #f1f5f9;
}

.navItemActive:hover {
  background: #eff6ff;
}

.toggleButton:hover:not(.toggleButtonActive) {
  border-color: #94a3b8;
  background: white;
}

.metricCard:hover {
  transform: translateY(-2px);
  boxShadow: 0 4px 12px rgba(0,0,0,0.05);
  transition: all 0.2s ease;
}

.summaryCard:hover {
  boxShadow: 0 4px 12px rgba(0,0,0,0.05);
  transition: all 0.2s ease;
}

.copyButton:hover {
  background: #1d4ed8 !important;
  transform: translateY(-1px);
}

.successButton:hover {
  background: #1d4ed8 !important;
  transform: translateY(-1px);
}

.successSecondaryButton:hover {
  background: #f8fafc !important;
  border-color: #cbd5e1 !important;
}

.errorCloseButton:hover {
  background: rgba(0,0,0,0.1) !important;
}

@media (max-width: 1024px) {
  .mainLayout {
    grid-template-columns: 1fr;
  }
  
  .formGrid {
    grid-template-columns: 1fr;
  }
  
  .metricsGrid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .summaryGrid {
    grid-template-columns: 1fr;
  }
  
  .reviewGrid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .container {
    padding: 16px;
  }
  
  .header {
    flex-direction: column;
    text-align: center;
  }
  
  .headerLeft, .headerRight {
    width: 100%;
    justify-content: center;
  }
  
  .contentArea {
    padding: 20px;
  }
  
  .formActions {
    flex-direction: column;
  }
  
  .summaryHeader {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  
  .metricsGrid {
    grid-template-columns: 1fr;
  }
  
  .summaryMeta {
    flex-direction: column;
    gap: 8px;
  }
  
  .summaryBadge {
    justify-content: center;
  }
  
  .additionalInfo {
    flex-direction: column;
    align-items: center;
  }
  
  .modalContent {
    width: 95%;
    margin: 10px;
  }
  
  .modalFooter {
    flex-direction: column;
  }
  
  .reviewHeader {
    flex-direction: column;
    text-align: center;
  }
  
  .reviewInfo {
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }
  
  .testConnectionContainer {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .successActions {
    flex-direction: column;
  }
  
  .imageUrlBox {
    flex-direction: column;
  }
}
`;

// Add the CSS to the document
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}