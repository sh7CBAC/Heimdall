package service

import (
	"errors"
	"strings"
	"time"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"

	"gorm.io/gorm"
)

// ClientActivityStatus is the authoritative monitoring state returned to the
// API and used when generating the Core monitoring allowlist.
type ClientActivityStatus struct {
	ClientID   int   `json:"clientId"`
	Enabled    bool  `json:"enabled"`
	Generation int64 `json:"generation"`
	DataEpoch  int64 `json:"dataEpoch"`
}

// ClientActivityService owns monitoring lifecycle state. Collection and
// destination aggregation are added separately so administrative operations
// stay independent from the traffic hot path.
type ClientActivityService struct{}

func defaultClientActivityStatus(clientID int) *ClientActivityStatus {
	return &ClientActivityStatus{
		ClientID:   clientID,
		Enabled:    false,
		Generation: 0,
		DataEpoch:  1,
	}
}

func statusFromActivitySetting(
	row *model.ClientActivitySetting,
) *ClientActivityStatus {
	if row == nil {
		return defaultClientActivityStatus(0)
	}

	epoch := row.DataEpoch
	if epoch < 1 {
		epoch = 1
	}

	return &ClientActivityStatus{
		ClientID:   row.ClientID,
		Enabled:    row.Enabled,
		Generation: row.Generation,
		DataEpoch:  epoch,
	}
}

func (s *ClientActivityService) StatusByEmail(
	email string,
) (*ClientActivityStatus, error) {
	client, err := (&ClientService{}).GetRecordByEmail(
		nil,
		strings.TrimSpace(email),
	)
	if err != nil {
		return nil, err
	}

	return s.StatusByClientID(client.Id)
}

func (s *ClientActivityService) StatusByClientID(
	clientID int,
) (*ClientActivityStatus, error) {
	if clientID <= 0 {
		return nil, gorm.ErrRecordNotFound
	}

	var row model.ClientActivitySetting
	err := database.GetDB().
		Where("client_id = ?", clientID).
		First(&row).
		Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultClientActivityStatus(clientID), nil
	}
	if err != nil {
		return nil, err
	}

	return statusFromActivitySetting(&row), nil
}

func ensureClientActivitySetting(
	tx *gorm.DB,
	clientID int,
) error {
	row := model.ClientActivitySetting{
		ClientID:  clientID,
		DataEpoch: 1,
	}

	if err := tx.
		Where("client_id = ?", clientID).
		FirstOrCreate(&row).
		Error; err != nil {
		return err
	}

	if row.DataEpoch >= 1 {
		return nil
	}

	return tx.
		Model(&model.ClientActivitySetting{}).
		Where("client_id = ?", clientID).
		UpdateColumn("data_epoch", 1).
		Error
}

// SetMonitoringByEmail starts or stops Activity monitoring for one client.
//
// Every transition increments Generation. Existing connections holding an old
// generation therefore cannot submit events after monitoring has been stopped
// or restarted.
func (s *ClientActivityService) SetMonitoringByEmail(
	email string,
	enabled bool,
) (*ClientActivityStatus, error) {
	client, err := (&ClientService{}).GetRecordByEmail(
		nil,
		strings.TrimSpace(email),
	)
	if err != nil {
		return nil, err
	}

	return s.SetMonitoringByClientID(client.Id, enabled)
}

func (s *ClientActivityService) SetMonitoringByClientID(
	clientID int,
	enabled bool,
) (*ClientActivityStatus, error) {
	if clientID <= 0 {
		return nil, gorm.ErrRecordNotFound
	}

	var status *ClientActivityStatus

	err := database.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := ensureClientActivitySetting(tx, clientID); err != nil {
			return err
		}

		var current model.ClientActivitySetting
		if err := tx.
			Where("client_id = ?", clientID).
			First(&current).
			Error; err != nil {
			return err
		}

		// Repeating Start while already enabled, or Stop while already disabled,
		// is a no-op. This makes retries and accidental double submissions safe
		// without invalidating active trackers unnecessarily.
		if current.Enabled == enabled {
			status = statusFromActivitySetting(&current)
			return nil
		}

		now := time.Now().UnixMilli()

		result := tx.
			Model(&model.ClientActivitySetting{}).
			Where("client_id = ?", clientID).
			Updates(map[string]any{
				"enabled":    enabled,
				"generation": gorm.Expr("generation + ?", 1),
				"updated_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}

		var row model.ClientActivitySetting
		if err := tx.
			Where("client_id = ?", clientID).
			First(&row).
			Error; err != nil {
			return err
		}

		status = statusFromActivitySetting(&row)
		return nil
	})
	if err != nil {
		return nil, err
	}

	return status, nil
}

// ResetByEmail permanently deletes all collected Activity data for one client.
//
// Monitoring remains in its previous enabled/disabled state. Generation and
// DataEpoch are incremented atomically so delayed events from connections that
// existed before the reset cannot repopulate the cleared history.
func (s *ClientActivityService) ResetByEmail(
	email string,
) (*ClientActivityStatus, error) {
	client, err := (&ClientService{}).GetRecordByEmail(
		nil,
		strings.TrimSpace(email),
	)
	if err != nil {
		return nil, err
	}

	return s.ResetByClientID(client.Id)
}

func (s *ClientActivityService) ResetByClientID(
	clientID int,
) (*ClientActivityStatus, error) {
	if clientID <= 0 {
		return nil, gorm.ErrRecordNotFound
	}

	var status *ClientActivityStatus

	err := database.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := ensureClientActivitySetting(tx, clientID); err != nil {
			return err
		}

		now := time.Now().UnixMilli()

		result := tx.
			Model(&model.ClientActivitySetting{}).
			Where("client_id = ?", clientID).
			Updates(map[string]any{
				"generation": gorm.Expr("generation + ?", 1),
				"data_epoch": gorm.Expr("data_epoch + ?", 1),
				"updated_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}

		if err := tx.
			Where("client_id = ?", clientID).
			Delete(&model.ClientActivityDestination{}).
			Error; err != nil {
			return err
		}

		var row model.ClientActivitySetting
		if err := tx.
			Where("client_id = ?", clientID).
			First(&row).
			Error; err != nil {
			return err
		}

		status = statusFromActivitySetting(&row)
		return nil
	})
	if err != nil {
		return nil, err
	}

	return status, nil
}

// BumpGenerationForClientID invalidates trackers created using an older
// runtime identity, for example after a client email rename.
func (s *ClientActivityService) BumpGenerationForClientID(
	tx *gorm.DB,
	clientID int,
) error {
	if clientID <= 0 {
		return nil
	}
	if tx == nil {
		tx = database.GetDB()
	}

	return tx.
		Model(&model.ClientActivitySetting{}).
		Where("client_id = ?", clientID).
		Updates(map[string]any{
			"generation": gorm.Expr("generation + ?", 1),
			"updated_at": time.Now().UnixMilli(),
		}).
		Error
}

// DeleteForClientID removes both Activity history and monitoring state when a
// client itself is permanently deleted.
func (s *ClientActivityService) DeleteForClientID(
	tx *gorm.DB,
	clientID int,
) error {
	if clientID <= 0 {
		return nil
	}

	deleteRows := func(db *gorm.DB) error {
		if err := db.
			Where("client_id = ?", clientID).
			Delete(&model.ClientActivityDestination{}).
			Error; err != nil {
			return err
		}

		return db.
			Where("client_id = ?", clientID).
			Delete(&model.ClientActivitySetting{}).
			Error
	}

	if tx != nil {
		return deleteRows(tx)
	}

	return database.GetDB().Transaction(deleteRows)
}
